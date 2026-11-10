// HomunculusAgent implementation (spec 03 §3.2): Brookesia agent_manager agent + HDP/1 client.
// The base agent::Base class owns the audio encoder/decoder dataflow operations; this file
// maps them onto HDP/1 (spec 04): uplink Opus frames are sent via WebSocket, downlink Opus
// frames are fed back through Base::feed_audio_decoder_data().
//
// Brookesia integration (agent_manager 0.8):
// - The agent stays in the Started/Awake state. Wake words are taken from the AudioEncoder
//   AFEEventHappened event; Brookesia only forwards WakeStart to on_wakeup() when Slept.
// - afe_wake_start/end_timeout_ms = 0: the encoder service never emits WakeEnd, so Brookesia
//   never moves the agent to Sleep (which would drop encoder data and decoder writes).
// - support_general_functions = {InterruptSpeaking} and set_speaking() around TTS: Brookesia
//   calls on_interrupt_speaking() on WakeStart while speaking (wake-word barge-in) and then
//   drops decoder writes until reset_interrupted_speaking() (called at the next tts start).
#include "homunculus/agent.hpp"
#include "homunculus/settings.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_pthread.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "brookesia/service_helper.hpp"
#include "brookesia/service_manager.hpp"
#include "brookesia/service_audio/service_audio.hpp"
#include "brookesia/service_helper/media/audio.hpp"
#include "brookesia/lib_utils/plugin.hpp"
#include "hdp_client.hpp"
#include "homunculus/hdp.hpp"
#include "homunculus/ota.hpp"
#include "homunculus/pairing.hpp"
#include "homunculus/wifi.hpp"

namespace homunculus {

using AudioHelper = esp_brookesia::service::helper::Audio;
using AudioEncoderHelper = esp_brookesia::service::helper::AudioEncoder<0>;
using AudioDecoderHelper = esp_brookesia::service::helper::AudioDecoder<0>;
using AudioPlaybackHelper = esp_brookesia::service::helper::AudioPlayback;
using AgentManagerHelper = esp_brookesia::service::helper::AgentManager;

namespace {

constexpr const char *TAG = "hom_agent";
constexpr size_t DL_QUEUE_MAX = 64;                     // frames (3.8 s at 60 ms)
constexpr int64_t UPLINK_LAST_WAIT_SERVER_US = 200 * 1000;  // wait for a frame to carry the last flag
constexpr int64_t UPLINK_LAST_WAIT_DEVICE_US = 100 * 1000;

int64_t now_us()
{
    return esp_timer_get_time();
}

// Creates a std::thread with its own name / stack / priority / core (esp_pthread),
// restoring the caller's pthread defaults afterwards.
std::thread spawn(const char *name, size_t stack, int prio, int core, std::function<void()> fn)
{
    esp_pthread_cfg_t saved = esp_pthread_get_default_config();
    const bool had_cfg = esp_pthread_get_cfg(&saved) == ESP_OK;
    esp_pthread_cfg_t cfg = esp_pthread_get_default_config();
    cfg.stack_size = stack;
    cfg.prio = prio;
    cfg.thread_name = name;
    cfg.pin_to_core = core;
    // Stacks in PSRAM (CONFIG_SPIRAM_ALLOW_STACK_EXTERNAL_MEMORY): internal RAM is scarce with
    // Wi-Fi + AFE running; these threads do no flash access.
    cfg.stack_alloc_caps = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
    esp_pthread_set_cfg(&cfg);
    std::thread t(std::move(fn));
    if (had_cfg) {
        esp_pthread_set_cfg(&saved);
    } else {
        cfg = esp_pthread_get_default_config();
        esp_pthread_set_cfg(&cfg);
    }
    return t;
}

}  // namespace

const char *to_string(UiState s)
{
    switch (s) {
    case UiState::Offline: return "offline";
    case UiState::Idle: return "idle";
    case UiState::Listening: return "listening";
    case UiState::Thinking: return "thinking";
    case UiState::Speaking: return "speaking";
    }
    return "?";
}

// ---------------------------------------------------------------------------
// Singleton

HomunculusAgent &HomunculusAgent::get_instance()
{
    static HomunculusAgent instance;
    return instance;
}

HomunculusAgent::HomunculusAgent(): esp_brookesia::agent::Base(
    esp_brookesia::agent::AgentAttributes{
        .name = NAME,
        .support_general_functions = {AgentManagerHelper::AgentGeneralFunction::InterruptSpeaking},
    },
    FIRMWARE,
    esp_brookesia::agent::AudioConfig{
        .encoder = AudioHelper::EncoderDynamicConfig{
            .type = AudioHelper::CodecFormat::OPUS,
            .general = {
                .channels = 1,
                .sample_bits = 16,
                .sample_rate = 16000,
                .frame_duration = 60,
            },
            // Without an Opus extra config the encoder is opened with bitrate 0 and fails.
            .extra = AudioHelper::EncoderExtraConfigOpus{
                .enable_vbr = true,
                .bitrate = 24000,
            },
            .enable_afe = true,
            // 0 = never emit WakeEnd (no automatic Brookesia Sleep, see file header).
            .afe_wake_start_timeout_ms = 0,
            .afe_wake_end_timeout_ms = 0,
        },
        .decoder = AudioHelper::DecoderDynamicConfig{
            .type = AudioHelper::CodecFormat::OPUS,
            .general = {
                .channels = 1,
                .sample_bits = 16,
                .sample_rate = 16000,
                .frame_duration = 60,
            },
        },
    },
    esp_brookesia::agent::ServiceConfig{
        .dependencies = {
            std::string(AudioEncoderHelper::get_name()),
            std::string(AudioDecoderHelper::get_name()),
            std::string(AudioPlaybackHelper::get_name()),
        },
    })
{
}

// ---------------------------------------------------------------------------
// Base class lifecycle

bool HomunculusAgent::on_activate()
{
    ESP_LOGI(TAG, "activate");
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Activated);
    return true;
}

bool HomunculusAgent::on_startup()
{
    ESP_LOGI(TAG, "startup");
    const auto &words = get_wake_words();
    if (!words.empty()) {
        wake_word_ = words.front();
        std::transform(wake_word_.begin(), wake_word_.end(), wake_word_.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    }
    afe_connection_ = AudioEncoderHelper::subscribe_event(
                          AudioEncoderHelper::EventId::AFEEventHappened,
    [this](const std::string &, const std::string &event) {
        if (event == "WakeStart") {
            ESP_LOGI(TAG, "AFE WakeStart");
            post([this] { on_wake_word(); });
        }
    });
    if (!afe_connection_.connected()) {
        ESP_LOGW(TAG, "AFE event subscription failed: wake word disabled");
    }

    running_ = true;
    worker_ = spawn("hom_worker", 8 * 1024, 6, 0, [this] { worker_loop(); });
    player_ = spawn("hom_player", 8 * 1024, 7, 0, [this] { player_loop(); });
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Started);
    return true;
}

void HomunculusAgent::on_shutdown()
{
    // Brookesia calls this before stop_audio_encoder(): the encoder thread may still call
    // on_encoder_data_ready(). Uplink is disabled and client_ released under uplink_mutex_;
    // an in-flight send keeps its own shared_ptr and HdpClient::stop() waits for it.
    ESP_LOGI(TAG, "shutdown");
    afe_connection_.disconnect();
    running_ = false;
    {
        std::lock_guard lock(work_mutex_);
        work_cv_.notify_all();
    }
    {
        std::lock_guard lock(player_mutex_);
        player_cv_.notify_all();
    }
    if (worker_.joinable()) worker_.join();
    if (player_.joinable()) player_.join();

    std::shared_ptr<HdpClient> client;
    {
        std::lock_guard lock(uplink_mutex_);
        uplink_active_ = false;
        uplink_end_pending_ = false;
        client = std::move(client_);
    }
    if (client) {
        client->send_text(hdp::make_goodbye("shutdown"), 200);
        client->stop();
    }
    {
        std::lock_guard lock(player_mutex_);
        player_reset_locked();
        accept_downlink_ = false;
    }
    session_ready_ = false;
    ui_ = UiState::Offline;
    if (state_cb_) state_cb_(UiState::Offline);
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Stopped);
}

bool HomunculusAgent::on_sleep()
{
    // Not triggered by this agent (WakeEnd disabled). If something else sleeps the agent,
    // Brookesia drops encoder data and decoder writes; the HDP session and UI stay as they are.
    ESP_LOGI(TAG, "sleep");
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Slept);
    return true;
}

bool HomunculusAgent::on_wakeup()
{
    // The wake word itself is handled from the AFE event subscription.
    ESP_LOGI(TAG, "wakeup");
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Awake);
    return true;
}

bool HomunculusAgent::on_interrupt_speaking()
{
    // Brookesia: AFE WakeStart while is_speaking(). Same handling as the wake word
    // subscription; whichever arrives second is ignored (already listening).
    ESP_LOGI(TAG, "interrupt_speaking");
    post([this] { on_wake_word(); });
    return true;
}

bool HomunculusAgent::on_encoder_data_ready(const uint8_t *data, size_t data_size)
{
    if (!data || data_size == 0) return true;

    std::vector<uint8_t> frame;
    std::shared_ptr<HdpClient> client;
    bool last = false;
    uint16_t sid = 0;
    {
        std::lock_guard lock(uplink_mutex_);
        if (!uplink_active_) return true;
        last = uplink_end_pending_;
        sid = stream_id_;
        frame = hdp::encode_frame(hdp::FRAME_OPUS_UPLINK, hdp::stream_flags(uplink_seq_, last), stream_id_,
                                  uplink_seq_, data, data_size);
        uplink_seq_++;
        if (last) {
            uplink_end_pending_ = false;
            uplink_active_ = false;
        }
        client = client_;
    }
    if (frame.empty()) {
        ESP_LOGW(TAG, "uplink frame too large (%u bytes)", static_cast<unsigned>(data_size));
        return true;
    }

    const int64_t t0 = now_us();
    const bool ok = client && client->send_binary(frame.data(), frame.size(), 100);
    const int64_t dt = now_us() - t0;
    {
        std::lock_guard lock(stats_mutex_);
        if (!ok) stats_.up_send_fail++;
        stats_.up_frames++;
        stats_.up_bytes += data_size;
        stats_.up_send_max_us = std::max(stats_.up_send_max_us, dt);
        if (stats_.last_frame_us > 0) {
            stats_.up_gap_max_us = std::max(stats_.up_gap_max_us, t0 - stats_.last_frame_us);
        }
        stats_.last_frame_us = t0;
    }
    if (last) {
        post([this, sid] { uplink_done(sid, true); });
    }
    return true;
}

// ---------------------------------------------------------------------------
// Public setters / touch

void HomunculusAgent::set_state_callback(StateCallback cb)
{
    state_cb_ = std::move(cb);
}

void HomunculusAgent::set_confirm_callback(ConfirmCallback cb)
{
    confirm_cb_ = std::move(cb);
}

void HomunculusAgent::set_session_callback(SessionCallback cb)
{
    session_cb_ = std::move(cb);
}

void HomunculusAgent::add_tool(std::string name, std::string description, boost::json::object input_schema,
                               ToolHandler handler)
{
    tools_.push_back({{std::move(name), std::move(description), std::move(input_schema)}, std::move(handler)});
}

void HomunculusAgent::set_caption_callback(CaptionCallback cb)
{
    caption_cb_ = std::move(cb);
}

void HomunculusAgent::touch()
{
    post([this] {
        ESP_LOGI(TAG, "touch (ui %s)", to_string(ui_.load()));
        if (ui_ == UiState::Listening) {
            end_uplink(true, "touch");
        } else {
            start_listen("touch", nullptr, "barge_in");
        }
    });
}

void HomunculusAgent::touch_at(int x, int y, int width, int height)
{
    post([=, this] {
        if (confirm_id_.empty()) {
            ESP_LOGI(TAG, "touch (ui %s)", to_string(ui_.load()));
            if (ui_ == UiState::Listening) {
                end_uplink(true, "touch");
            } else {
                start_listen("touch", nullptr, "barge_in");
            }
            return;
        }
        // Ignore the tap that may have been in progress when the card appeared, and the upper half.
        if (now_us() - confirm_shown_us_ < 400 * 1000 || y < height * 62 / 100) return;
        finish_confirm(true, x >= width / 2, "touch");
    });
}

void HomunculusAgent::simulate_wake_word()
{
    post([this] { on_wake_word(); });
}

void HomunculusAgent::reconnect()
{
    post([this] {
        ESP_LOGW(TAG, "reconnect requested");
        drop_connection();
    });
}

// ---------------------------------------------------------------------------
// Worker thread

void HomunculusAgent::post(std::function<void()> fn)
{
    {
        std::lock_guard lock(work_mutex_);
        work_.push_back(std::move(fn));
    }
    work_cv_.notify_one();
}

void HomunculusAgent::worker_loop()
{
    ESP_LOGI(TAG, "worker start");
    while (running_) {
        std::unique_lock lock(work_mutex_);
        work_cv_.wait_for(lock, std::chrono::milliseconds(10), [this] { return !work_.empty() || !running_; });
        while (!work_.empty() && running_) {
            auto fn = std::move(work_.front());
            work_.pop_front();
            lock.unlock();
            fn();
            lock.lock();
        }
        lock.unlock();
        if (running_) tick();
    }
    ESP_LOGI(TAG, "worker end");
}

std::vector<hdp::ToolDescriptor> HomunculusAgent::tool_descriptors() const
{
    std::vector<hdp::ToolDescriptor> out;
    for (const auto &t : tools_) out.push_back(t.desc);
    return out;
}

void HomunculusAgent::tick()
{
    const int64_t now = now_us();
    if (!confirm_id_.empty() && now > confirm_deadline_us_) finish_confirm(true, false, "timeout");

    // Not paired (or token revoked): the pairing thread runs; no HDP connection without a token.
    if (!client_ && wifi::is_connected() && pairing::paired()) {
        connect();
    }
    if (client_ && !pairing::paired()) {
        ESP_LOGW(TAG, "no device token");
        drop_connection();
    }
    // Wi-Fi lost: the WebSocket notices only on the next failed send or ping timeout.
    // Drop the connection so the next session starts with a fresh hello.
    if (client_ && !wifi::is_connected()) {
        ESP_LOGW(TAG, "wifi lost");
        drop_connection();
    }

    if (session_ready_) {
        bool active, end_pending, by_device;
        uint16_t sid;
        {
            std::lock_guard lock(uplink_mutex_);
            active = uplink_active_;
            end_pending = uplink_end_pending_;
            by_device = uplink_end_by_device_;
            sid = stream_id_;
        }
        if (active && !end_pending && listen_deadline_us_ > 0 && now > listen_deadline_us_) {
            end_uplink(true, "max_length");
        }
        if (end_pending && uplink_done_deadline_us_ > 0 && now > uplink_done_deadline_us_) {
            // No encoder frame arrived to carry the last flag: end the stream with listen.stop.
            {
                std::lock_guard lock(uplink_mutex_);
                uplink_end_pending_ = false;
                uplink_active_ = false;
            }
            uplink_done_deadline_us_ = 0;
            if (by_device) send(hdp::make_listen_stop());
            uplink_done(sid, false);
        }
        if (ui_ == UiState::Thinking && thinking_deadline_us_ > 0 && now > thinking_deadline_us_) {
            ESP_LOGW(TAG, "thinking timeout");
            to_idle();
        }
    }

    // tts.played events that are due (estimated end of playback of each segment).
    std::vector<uint16_t> played;
    {
        std::lock_guard lock(player_mutex_);
        for (auto it = dl_played_due_.begin(); it != dl_played_due_.end();) {
            if (now >= it->second) {
                played.push_back(it->first);
                it = dl_played_due_.erase(it);
            } else {
                ++it;
            }
        }
    }
    for (const uint16_t seg : played) {
        send(hdp::make_tts_played(seg));
    }
}

void HomunculusAgent::set_ui(UiState s)
{
    const UiState old = ui_.load();
    if (old == s) return;
    ESP_LOGI(TAG, "ui %s -> %s", to_string(old), to_string(s));
    ui_ = s;
    if (state_cb_) state_cb_(s);
}

// ---------------------------------------------------------------------------
// HDP connection

void HomunculusAgent::connect()
{
    const std::string url = settings::server_url();
#if !CONFIG_HOMUNCULUS_ALLOW_PLAIN_WS
    if (url.rfind("ws://", 0) == 0) {
        if (!url_rejected_) {
            ESP_LOGE(TAG, "ws:// server URL rejected (CONFIG_HOMUNCULUS_ALLOW_PLAIN_WS disabled)");
            url_rejected_ = true;
        }
        return;
    }
#endif
    auto client = std::make_shared<HdpClient>();
    const bool ok = client->start(
    {
        .url = url,
        .token = settings::token(),
        .device_id = wifi::mac_string(),
        .model = MODEL,
        .firmware = ota::running_version(),
    },
    {
        .connected = [this] { post([this] { handle_connected(); }); },
        .disconnected = [this] {
            post([this] {
                // The paired server may have a new address (DHCP): every 5 failed attempts look it
                // up via mDNS.
                if (!session_ready_ && ++failed_connects_ % 5 == 0) pairing::on_unreachable();
                handle_disconnected();
            });
        },
        .text = [this](std::string &&s) { post([this, s = std::move(s)] { handle_text(s); }); },
        .binary = [this](const uint8_t *d, size_t n) {
            std::vector<uint8_t> v(d, d + n);
            post([this, v = std::move(v)] { handle_binary(v.data(), v.size()); });
        },
        .rejected = [](int status) {
            if (status == 401) pairing::on_unauthorized();
        },
    });
    if (!ok) {
        return;  // retried on the next tick
    }
    std::lock_guard lock(uplink_mutex_);
    client_ = std::move(client);
}

void HomunculusAgent::drop_connection()
{
    handle_disconnected();
    std::shared_ptr<HdpClient> client;
    {
        std::lock_guard lock(uplink_mutex_);
        client = std::move(client_);
    }
    if (client) client->stop();
}

void HomunculusAgent::handle_connected()
{
    ESP_LOGI(TAG, "hdp connected%s%s", session_id_.empty() ? "" : ", resume ", session_id_.c_str());
    hdp::HelloParams p{
        .model = MODEL,
        .firmware = ota::running_version(),
        .board = BOARD,
        .display_width = 466,
        .display_height = 466,
        .display_shape = "round",
        .color_depth = 16,
        .output_sample_rates = {16000},
        .mics = 1,
        .aec = true,
        .wake_word = afe_connection_.connected(),
        .inputs = {"touch"},
        .battery = std::nullopt,
        .avatar_engine = {},
        .emotes = {},
        .tools = tool_descriptors(),
        .resume_session_id = session_id_,
    };
    send(hdp::make_hello(p));
}

void HomunculusAgent::handle_disconnected()
{
    finish_confirm(false, false, "disconnected");
    const bool was_ready = session_ready_.exchange(false);
    if (was_ready) ESP_LOGW(TAG, "hdp session lost");
    abort_uplink();
    listen_deadline_us_ = 0;
    uplink_done_deadline_us_ = 0;
    thinking_deadline_us_ = 0;
    stop_playback();
    set_ui(UiState::Offline);
}

void HomunculusAgent::handle_text(const std::string &text)
{
    auto m = hdp::parse_server_message(text);
    if (!session_ready_) {
        if (m.type == hdp::ServerType::Hello) {
            handle_hello(m);
        } else if (m.type == hdp::ServerType::Error) {
            ESP_LOGW(TAG, "server error before hello: %s: %s", m.code.c_str(), m.message.c_str());
        } else {
            ESP_LOGW(TAG, "expected hello, got %s (ignored)", m.type_name.c_str());
        }
        return;
    }

    switch (m.type) {
    case hdp::ServerType::Invalid:
        ESP_LOGW(TAG, "invalid message: %s", m.error.c_str());
        break;
    case hdp::ServerType::Hello:
        handle_hello(m);
        break;
    case hdp::ServerType::Listen:
        if (m.state == "stop") end_uplink(false, "server");
        break;
    case hdp::ServerType::Stt:
        if (m.final) ESP_LOGI(TAG, "stt: %s", m.text.c_str());
        if (caption_cb_) caption_cb_(false, m.text, m.final);
        break;
    case hdp::ServerType::AgentStatus:
        if (m.phase == "thinking" || m.phase == "tool" || m.phase == "responding") {
            if (ui_ == UiState::Idle) set_ui(UiState::Thinking);
        } else if (m.phase == "done") {
            if (ui_ == UiState::Thinking) to_idle();
        } else if (m.phase == "error") {
            if (ui_ == UiState::Thinking) to_idle();
        }
        break;
    case hdp::ServerType::Tts:
        handle_tts(m);
        break;
    case hdp::ServerType::Avatar:
        // Avatar rendering is Phase 2. avatar{state: idle} ends a turn without speech
        // (no speech detected, empty transcript).
        if (!m.state.empty()) {
            server_idle_ = m.state == "idle";
            if (server_idle_ && ui_ == UiState::Thinking) to_idle();
        }
        break;
    case hdp::ServerType::ToolCall:
        handle_tool_call(m);
        break;
    case hdp::ServerType::ConfirmRequest:
        handle_confirm_request(m);
        break;
    case hdp::ServerType::Notify:
        if (caption_cb_) caption_cb_(true, m.text, true);
        break;
    case hdp::ServerType::Config:
        break;
    case hdp::ServerType::Error:
        ESP_LOGW(TAG, "server error %s: %s", m.code.c_str(), m.message.c_str());
        if (ui_ == UiState::Thinking) to_idle();
        break;
    default:
        break;
    }
}

void HomunculusAgent::handle_hello(const hdp::ServerMessage &m)
{
    if (m.format != "opus") {
        ESP_LOGE(TAG, "server downlink format %s not supported", m.format.c_str());
    }
    if (!session_id_.empty() && m.session_id != session_id_) {
        ESP_LOGI(TAG, "session %s not resumed", session_id_.c_str());
    }
    session_id_ = m.session_id;
    // Opus decodes at any output rate; the downlink rate only matters for the encoder side.
    dl_frame_us_ = static_cast<int64_t>(m.frame_ms) * 1000;
    session_ready_ = true;
    failed_connects_ = 0;
    {
        std::lock_guard lock(uplink_mutex_);
        if (client_) client_->reset_backoff();
    }
    ESP_LOGI(TAG, "session %s, downlink %s %u Hz %u ms", session_id_.c_str(), m.format.c_str(),
             static_cast<unsigned>(m.sample_rate), static_cast<unsigned>(m.frame_ms));
    set_ui(UiState::Idle);
    if (session_cb_) session_cb_();
}

void HomunculusAgent::handle_tts(const hdp::ServerMessage &m)
{
    if (m.state == "start") {
        {
            std::lock_guard lock(uplink_mutex_);
            if (uplink_active_ && !uplink_end_pending_) {
                ESP_LOGW(TAG, "tts start while listening ignored");
                return;
            }
        }
        {
            std::lock_guard lock(player_mutex_);
            player_reset_locked();
            accept_downlink_ = true;
        }
        {
            std::lock_guard lock(stats_mutex_);
            if (stats_.tts_start_us == 0) stats_.tts_start_us = now_us();
        }
        thinking_deadline_us_ = 0;
        // Brookesia drops decoder writes while interrupted (after a wake-word barge-in).
        reset_interrupted_speaking();
        set_speaking(true);
        if (ui_ != UiState::Listening) set_ui(UiState::Speaking);
        return;
    }
    if (m.state == "segment_start") {
        if (!m.text.empty()) ESP_LOGI(TAG, "tts segment %u: %s", m.segment_id.value_or(0), m.text.c_str());
        if (caption_cb_ && !m.text.empty()) caption_cb_(true, m.text, false);
        return;
    }
    if (m.state == "segment_end") {
        if (m.segment_id) {
            std::lock_guard lock(player_mutex_);
            if (accept_downlink_) {
                dl_segments_ended_.insert(static_cast<uint16_t>(*m.segment_id));
                player_check_segment_locked(static_cast<uint16_t>(*m.segment_id));
            }
        }
        return;
    }
    if (m.state == "stop") {
        std::lock_guard lock(player_mutex_);
        if (accept_downlink_) {  // else: stream already flushed (barge-in)
            dl_stop_pending_ = true;
            player_cv_.notify_one();
        }
    }
}

void HomunculusAgent::handle_tool_call(const hdp::ServerMessage &m)
{
    ESP_LOGI(TAG, "tool.call %s", m.tool_name.c_str());
    const auto it = std::find_if(tools_.begin(), tools_.end(), [&](const Tool &t) { return t.desc.name == m.tool_name; });
    if (it == tools_.end()) {
        send(hdp::make_tool_error(m.rpc_id, -32601, "unknown device tool " + m.tool_name));
        return;
    }
    const ToolReply r = it->handler(m.arguments);
    ESP_LOGI(TAG, "tool %s -> %s: %s", m.tool_name.c_str(), r.ok ? "ok" : "error", r.text.c_str());
    auto result = hdp::text_content(r.text);
    if (!r.ok) result.as_object()["isError"] = true;
    send(hdp::make_tool_result(m.rpc_id, result));
}

void HomunculusAgent::handle_confirm_request(const hdp::ServerMessage &m)
{
    if (!confirm_cb_ || !confirm_id_.empty()) {
        ESP_LOGW(TAG, "confirm.request %s denied (%s)", m.request_id.c_str(),
                 confirm_cb_ ? "another confirmation pending" : "no confirmation UI");
        send(hdp::make_confirm_result(m.request_id, false));
        return;
    }
    ESP_LOGI(TAG, "confirm.request %s: %s", m.request_id.c_str(), m.title.c_str());
    confirm_id_ = m.request_id;
    confirm_shown_us_ = now_us();
    // Answer a little before the server gives up, so the denial is not lost.
    const int64_t ms = std::max<int64_t>(500, static_cast<int64_t>(m.timeout_ms) - 500);
    confirm_deadline_us_ = confirm_shown_us_ + ms * 1000;
    confirm_cb_(true, m.title, m.detail);
}

void HomunculusAgent::finish_confirm(bool answer, bool approved, const char *why)
{
    if (confirm_id_.empty()) return;
    ESP_LOGI(TAG, "confirm %s: %s (%s)", confirm_id_.c_str(), approved ? "approved" : "denied", why);
    if (answer) send(hdp::make_confirm_result(confirm_id_, approved));
    confirm_id_.clear();
    if (confirm_cb_) confirm_cb_(false, {}, {});
}

void HomunculusAgent::send(const std::string &text)
{
    if (client_ && !client_->send_text(text, 200)) {
        ESP_LOGW(TAG, "send_text failed");
    }
}

// ---------------------------------------------------------------------------
// Turns / uplink

void HomunculusAgent::on_wake_word()
{
    ESP_LOGI(TAG, "wake word (ui %s)", to_string(ui_.load()));
    if (ui_ == UiState::Listening) return;
    start_listen("wake_word", wake_word_.c_str(), "wake_word");
}

void HomunculusAgent::start_listen(const char *trigger, const char *wake_word, const char *abort_reason)
{
    if (!session_ready_) {
        ESP_LOGW(TAG, "listen ignored: no session");
        return;
    }
    if (ui_ == UiState::Listening) return;

    if (ui_ == UiState::Speaking || ui_ == UiState::Thinking) {
        send(hdp::make_abort(abort_reason ? abort_reason : "barge_in"));
        stop_playback();
    }
    finish_confirm(false, false, "listen");

    const int64_t t = now_us();
    {
        std::lock_guard lock(stats_mutex_);
        stats_ = TurnStats{};
        stats_.listen_start_us = t;
    }
    // listen.start goes out before the first uplink frame (spec 4.6).
    send(hdp::make_listen_start("auto", trigger, wake_word ? wake_word : ""));
    {
        std::lock_guard lock(uplink_mutex_);
        stream_id_++;
        uplink_seq_ = 0;
        uplink_end_pending_ = false;
        uplink_end_by_device_ = false;
        uplink_active_ = true;
    }
    server_idle_ = false;
    set_listening(true);
    listen_deadline_us_ = t + static_cast<int64_t>(CONFIG_HOMUNCULUS_MAX_UTTERANCE_MS) * 1000;
    uplink_done_deadline_us_ = 0;
    thinking_deadline_us_ = 0;
    set_ui(UiState::Listening);
}

void HomunculusAgent::end_uplink(bool by_device, const char *why)
{
    {
        std::lock_guard lock(uplink_mutex_);
        if (!uplink_active_ || uplink_end_pending_) return;
        uplink_end_pending_ = true;
        uplink_end_by_device_ = by_device;
    }
    {
        std::lock_guard lock(stats_mutex_);
        stats_.uplink_end = why;
        stats_.uplink_end_us = now_us();
    }
    uplink_done_deadline_us_ = now_us() + (by_device ? UPLINK_LAST_WAIT_DEVICE_US : UPLINK_LAST_WAIT_SERVER_US);
    listen_deadline_us_ = 0;
}

void HomunculusAgent::abort_uplink()
{
    bool was_active;
    {
        std::lock_guard lock(uplink_mutex_);
        was_active = uplink_active_;
        uplink_active_ = false;
        uplink_end_pending_ = false;
    }
    if (was_active) {
        std::lock_guard lock(stats_mutex_);
        ESP_LOGW(TAG, "uplink aborted after %u frames", static_cast<unsigned>(stats_.up_frames));
    }
    set_listening(false);
}

void HomunculusAgent::uplink_done(uint16_t stream_id, bool last_sent)
{
    {
        std::lock_guard lock(uplink_mutex_);
        if (stream_id != stream_id_ || uplink_active_) return;  // superseded by a new listen
    }
    uplink_done_deadline_us_ = 0;
    set_listening(false);
    log_uplink_stats();
    (void)last_sent;
    if (ui_ != UiState::Listening) return;
    if (server_idle_) {
        to_idle();
        return;
    }
    set_ui(UiState::Thinking);
    thinking_deadline_us_ = now_us() + static_cast<int64_t>(CONFIG_HOMUNCULUS_THINKING_TIMEOUT_MS) * 1000;
}

void HomunculusAgent::stop_playback()
{
    {
        std::lock_guard lock(player_mutex_);
        player_reset_locked();
        accept_downlink_ = false;
    }
    player_cv_.notify_one();
    set_speaking(false);
}

void HomunculusAgent::speech_finished(uint32_t generation)
{
    {
        std::lock_guard lock(player_mutex_);
        if (generation != dl_generation_) return;
        accept_downlink_ = false;
    }
    set_speaking(false);
    {
        std::lock_guard lock(stats_mutex_);
        stats_.play_end_us = now_us();
    }
    log_turn_stats();
    if (ui_ == UiState::Speaking) set_ui(UiState::Idle);
}

void HomunculusAgent::to_idle()
{
    finish_confirm(false, false, "turn ended");
    thinking_deadline_us_ = 0;
    stop_playback();
    set_ui(UiState::Idle);
}

// ---------------------------------------------------------------------------
// Downlink player
//
// Jitter buffer: playback (re)starts once CONFIG_HOMUNCULUS_JITTER_PREFILL_FRAMES frames are
// queued, or earlier when the stream is known to be complete (segment end / tts stop).
// Each fed frame advances the estimated end of playback by one frame duration
// (play_end = max(now, play_end) + frame). tts.played for a segment is due at the play end
// of its last frame; Speaking ends at the play end after tts stop.

void HomunculusAgent::handle_binary(const uint8_t *data, size_t len)
{
    auto frame = hdp::decode_frame(data, len);
    if (!frame) {
        ESP_LOGW(TAG, "bad downlink frame (%u bytes)", static_cast<unsigned>(len));
        return;
    }
    if (frame->type != hdp::FRAME_OPUS_DOWNLINK) {
        ESP_LOGW(TAG, "unexpected downlink frame type %u", frame->type);
        return;
    }
    bool dropped = false;
    bool overflow = false;
    {
        std::lock_guard lock(player_mutex_);
        if (!accept_downlink_) {
            dropped = true;
        } else {
            if (dl_queue_.size() >= DL_QUEUE_MAX) {
                dl_queue_.pop_front();
                overflow = true;
            }
            dl_queue_.push_back(DownlinkFrame{
                .segment = frame->stream_id,
                .flags = frame->flags,
                .data = std::vector<uint8_t>(frame->payload, frame->payload + frame->payload_len),
            });
        }
    }
    {
        std::lock_guard lock(stats_mutex_);
        if (dropped || overflow) stats_.dl_dropped++;
        if (!dropped && stats_.first_rx_us == 0) stats_.first_rx_us = now_us();
    }
    if (!dropped) player_cv_.notify_one();
}

void HomunculusAgent::player_reset_locked()
{
    dl_queue_.clear();
    dl_segments_ended_.clear();
    dl_segments_reported_.clear();
    dl_segment_play_end_.clear();
    dl_played_due_.clear();
    dl_primed_ = false;
    dl_stop_pending_ = false;
    dl_play_end_us_ = 0;
    dl_generation_++;
}

void HomunculusAgent::player_check_segment_locked(uint16_t segment)
{
    if (!dl_segments_ended_.count(segment) || dl_segments_reported_.count(segment)) return;
    for (const auto &f : dl_queue_) {
        if (f.segment == segment) return;  // frames still queued
    }
    dl_segments_reported_.insert(segment);
    auto it = dl_segment_play_end_.find(segment);
    const int64_t due = it != dl_segment_play_end_.end() ? it->second : now_us();
    dl_played_due_.push_back({segment, due});
}

void HomunculusAgent::player_loop()
{
    ESP_LOGI(TAG, "player start");
    const size_t prefill = CONFIG_HOMUNCULUS_JITTER_PREFILL_FRAMES;
    std::unique_lock lock(player_mutex_);
    while (running_) {
        const int64_t now = now_us();
        const bool complete = dl_stop_pending_ || (!dl_queue_.empty() && (dl_queue_.back().flags & hdp::FLAG_LAST));
        const bool can_play = !dl_queue_.empty() && (dl_primed_ || dl_queue_.size() >= prefill || complete);

        if (!can_play) {
            if (dl_queue_.empty() && now >= dl_play_end_us_) {
                if (dl_stop_pending_) {
                    // All audio of this tts stream has been played out.
                    dl_stop_pending_ = false;
                    dl_primed_ = false;
                    const uint32_t gen = dl_generation_;
                    post([this, gen] { speech_finished(gen); });
                } else if (dl_primed_) {
                    dl_primed_ = false;  // underrun: prefill again
                    std::lock_guard slock(stats_mutex_);
                    stats_.dl_underruns++;
                }
            }
            // Wake up when the buffered audio has played out, or on new data.
            int64_t wait_us = 20 * 1000;
            if (dl_play_end_us_ > now) wait_us = std::min<int64_t>(wait_us, dl_play_end_us_ - now + 1000);
            player_cv_.wait_for(lock, std::chrono::microseconds(wait_us));
            continue;
        }

        DownlinkFrame f = std::move(dl_queue_.front());
        dl_queue_.pop_front();
        dl_primed_ = true;
        const uint32_t gen = dl_generation_;
        lock.unlock();

        const bool ok = feed_audio_decoder_data(f.data.data(), f.data.size());
        const int64_t fed_at = now_us();
        {
            std::lock_guard slock(stats_mutex_);
            if (ok) {
                stats_.dl_frames++;
                if (stats_.first_fed_us == 0) stats_.first_fed_us = fed_at;
            } else {
                stats_.dl_feed_fail++;
            }
        }

        lock.lock();
        if (gen != dl_generation_) continue;  // flushed while feeding
        dl_play_end_us_ = std::max(fed_at, dl_play_end_us_) + dl_frame_us_.load();
        dl_segment_play_end_[f.segment] = dl_play_end_us_;
        if (f.flags & hdp::FLAG_LAST) dl_segments_ended_.insert(f.segment);
        player_check_segment_locked(f.segment);
    }
    ESP_LOGI(TAG, "player end");
}

// ---------------------------------------------------------------------------
// Statistics

void HomunculusAgent::log_uplink_stats()
{
#if CONFIG_HOMUNCULUS_TURN_STATS
    std::lock_guard lock(stats_mutex_);
    const int64_t now = now_us();
    ESP_LOGI(TAG,
             "uplink: %lld ms, end=%s, frames=%u, bytes=%u, send_fail=%u, gap_max=%lld ms, send_max=%lld ms",
             stats_.listen_start_us > 0 ? (now - stats_.listen_start_us) / 1000 : 0LL, stats_.uplink_end,
             static_cast<unsigned>(stats_.up_frames), static_cast<unsigned>(stats_.up_bytes),
             static_cast<unsigned>(stats_.up_send_fail), stats_.up_gap_max_us / 1000, stats_.up_send_max_us / 1000);
#endif
}

void HomunculusAgent::log_turn_stats()
{
#if CONFIG_HOMUNCULUS_TURN_STATS
    std::lock_guard lock(stats_mutex_);
    auto rel = [this](int64_t t) -> long long {
        return (t > 0 && stats_.uplink_end_us > 0) ? (t - stats_.uplink_end_us) / 1000 : -1;
    };
    // Times in ms after listen.stop (server endpoint) / device end of utterance.
    ESP_LOGI(TAG,
             "turn: after listen.stop: tts_start=%lld ms, first_rx=%lld ms, first_fed=%lld ms, play_end=%lld ms; "
             "dl_frames=%u, dl_dropped=%u, dl_underruns=%u, dl_feed_fail=%u",
             rel(stats_.tts_start_us), rel(stats_.first_rx_us), rel(stats_.first_fed_us), rel(stats_.play_end_us),
             static_cast<unsigned>(stats_.dl_frames), static_cast<unsigned>(stats_.dl_dropped),
             static_cast<unsigned>(stats_.dl_underruns), static_cast<unsigned>(stats_.dl_feed_fail));
#endif
}

}  // namespace homunculus

// Register the agent with both the agent_manager registry (so the Manager can select it)
// and the service_manager registry (so ServiceManager starts its worker thread).
BROOKESIA_PLUGIN_REGISTER_SINGLETON_WITH_SYMBOL(
    esp_brookesia::agent::Base,
    homunculus::HomunculusAgent,
    homunculus::HomunculusAgent::NAME,
    homunculus::HomunculusAgent::get_instance(),
    homunculus_agent_symbol
)

BROOKESIA_PLUGIN_REGISTER_SINGLETON_WITH_SYMBOL(
    esp_brookesia::service::ServiceBase,
    homunculus::HomunculusAgent,
    homunculus::HomunculusAgent::NAME,
    homunculus::HomunculusAgent::get_instance(),
    homunculus_agent_service_symbol
)
