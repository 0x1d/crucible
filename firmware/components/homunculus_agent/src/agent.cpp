// HomunculusAgent implementation (spec 03 §3.2): Brookesia agent_manager agent + HDP/1 client.
// The base agent::Base class owns the audio encoder/decoder dataflow operations; this file
// maps them onto HDP/1 (spec 04): uplink Opus frames are sent via WebSocket, downlink Opus
// frames are fed back through Base::feed_audio_decoder_data().
#include "homunculus/agent.hpp"

#include <cmath>
#include <chrono>
#include <cstdio>
#include <cstring>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "brookesia/service_helper.hpp"
#include "brookesia/service_manager.hpp"
#include "brookesia/service_audio/service_audio.hpp"
#include "brookesia/service_helper/media/audio.hpp"
#include "brookesia/lib_utils/plugin.hpp"
#include "hdp_client.hpp"
#include "homunculus/hdp.hpp"
#include "homunculus/wifi.hpp"

namespace homunculus {

using AudioHelper = esp_brookesia::service::helper::Audio;
using AudioEncoderHelper = esp_brookesia::service::helper::AudioEncoder<0>;
using AudioDecoderHelper = esp_brookesia::service::helper::AudioDecoder<0>;
using AudioPlaybackHelper = esp_brookesia::service::helper::AudioPlayback;

namespace {

constexpr const char *TAG = "hom_agent";
constexpr int64_t FRAME_US = 60 * 1000;  // 60 ms Opus frame (server pacer rate)

const char *ui_to_string(UiState s)
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

}  // namespace

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
    },
    "0.1.0",
    esp_brookesia::agent::AudioConfig{
        .encoder = AudioHelper::EncoderDynamicConfig{
            .type = AudioHelper::CodecFormat::OPUS,
            .general = {
                .channels = 1,
                .sample_bits = 16,
                .sample_rate = 16000,
                .frame_duration = 60,
            },
            .extra = std::monostate{},
            .enable_afe = true,
        },
        .decoder = AudioHelper::DecoderDynamicConfig{
            .type = AudioHelper::CodecFormat::OPUS,
            .general = {
                .channels = 1,
                .sample_bits = 16,
                .sample_rate = 24000,
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
    running_ = true;
    worker_ = std::thread(&HomunculusAgent::worker_loop, this);
    player_ = std::thread(&HomunculusAgent::player_loop, this);
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Started);
    return true;
}

void HomunculusAgent::on_shutdown()
{
    ESP_LOGI(TAG, "shutdown");
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
    if (client_) client_->stop();
    client_.reset();
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Stopped);
}

bool HomunculusAgent::on_sleep()
{
    ESP_LOGI(TAG, "sleep");
    post([this] { set_ui(UiState::Offline); });
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Slept);
    return true;
}

bool HomunculusAgent::on_wakeup()
{
    ESP_LOGI(TAG, "wakeup");
    post([this] { start_listen("wake_word", nullptr); });
    trigger_general_event(esp_brookesia::agent::GeneralEvent::Awake);
    return true;
}

bool HomunculusAgent::on_interrupt_speaking()
{
    ESP_LOGI(TAG, "interrupt_speaking");
    post([this] { stop_speaking_locally(); });
    return true;
}

bool HomunculusAgent::on_encoder_data_ready(const uint8_t *data, size_t data_size)
{
    std::lock_guard lock(uplink_mutex_);
    if (!uplink_active_ || !data || data_size == 0) return true;

    uint8_t flags = 0;
    if (uplink_end_pending_) {
        flags |= hdp::FLAG_LAST;
        uplink_end_pending_ = false;
        uplink_active_ = false;
        stats_.uplink_end_us = esp_timer_get_time();
        // Hand off finalisation to worker thread.
        post([this] { uplink_done(); });
    }

    auto frame = hdp::encode_frame(hdp::FRAME_OPUS_UPLINK, flags, stream_id_, uplink_seq_++, data, data_size);
    if (frame.empty()) {
        ESP_LOGW(TAG, "uplink frame too large");
        return false;
    }

    const int64_t t0 = esp_timer_get_time();
    const bool ok = client_ && client_->send_binary(frame.data(), frame.size(), 100);
    if (!ok) stats_.up_send_fail++;

    const int64_t dt = esp_timer_get_time() - t0;
    stats_.up_frames++;
    stats_.up_bytes += data_size;
    if (dt > stats_.up_send_max_us) stats_.up_send_max_us = dt;
    if (stats_.last_frame_us > 0) {
        const int64_t gap = t0 - stats_.last_frame_us;
        stats_.up_gap_sum_us += gap;
        if (gap > stats_.up_gap_max_us) stats_.up_gap_max_us = gap;
    }
    stats_.last_frame_us = t0;
    return ok;
}

// ---------------------------------------------------------------------------
// Public setters / touch

void HomunculusAgent::set_state_callback(StateCallback cb)
{
    state_cb_ = std::move(cb);
}

void HomunculusAgent::set_caption_callback(CaptionCallback cb)
{
    caption_cb_ = std::move(cb);
}

void HomunculusAgent::touch()
{
    post([this] {
        if (ui_ == UiState::Speaking) {
            start_listen("touch", "barge_in");
        } else if (ui_ == UiState::Listening) {
            end_uplink_by_device("touch");
        } else {
            start_listen("touch", nullptr);
        }
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
        while (!work_.empty()) {
            auto fn = std::move(work_.front());
            work_.pop_front();
            lock.unlock();
            fn();
            lock.lock();
        }
        lock.unlock();
        tick();
    }
    ESP_LOGI(TAG, "worker end");
}

void HomunculusAgent::tick()
{
    const int64_t now = esp_timer_get_time();

    // Connect HDP once Wi-Fi is up.
    if (!client_ && wifi::is_connected()) {
        client_ = std::make_unique<HdpClient>();
        client_->start(
            {
                .url = CONFIG_HOMUNCULUS_SERVER_URL,
                .token = CONFIG_HOMUNCULUS_DEVICE_TOKEN,
                .device_id = wifi::mac_string(),
                .model = MODEL,
                .firmware = "0.1.0",
            },
            {
                .connected = [this] { post([this] { handle_connected(); }); },
                .disconnected = [this] { post([this] { handle_disconnected(); }); },
                .text = [this](std::string &&s) { post([this, s = std::move(s)]() mutable { handle_text(std::move(s)); }); },
                .binary = [this](const uint8_t *d, size_t n) {
                    std::vector<uint8_t> v(d, d + n);
                    post([this, v = std::move(v)]() mutable { handle_binary(v.data(), v.size()); });
                },
            });
    }

    // Timeouts while session is ready.
    if (session_ready_) {
        if (uplink_active_ && listen_deadline_us_ > 0 && now > listen_deadline_us_) {
            end_uplink_by_device("max_length");
        }
        if (uplink_end_pending_ && uplink_done_deadline_us_ > 0 && now > uplink_done_deadline_us_) {
            // No encoder frame arrived to carry the last-flag; finalize anyway.
            std::lock_guard lock(uplink_mutex_);
            uplink_end_pending_ = false;
            uplink_active_ = false;
            post([this] { uplink_done(); });
        }
        if (ui_ == UiState::Thinking && thinking_deadline_us_ > 0 && now > thinking_deadline_us_) {
            ESP_LOGW(TAG, "thinking timeout");
            stop_speaking_locally();
            set_ui(UiState::Idle);
        }
    }

    // Send tts.played events that are due.
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
    if (ui_.load() == s) return;
    ESP_LOGI(TAG, "ui %s -> %s", ui_to_string(ui_.load()), ui_to_string(s));
    ui_ = s;
    if (state_cb_) state_cb_(s);
}

// ---------------------------------------------------------------------------
// HDP connection

void HomunculusAgent::handle_connected()
{
    ESP_LOGI(TAG, "hdp connected");
    client_->reset_backoff();

    std::vector<uint32_t> rates = {16000, 24000};
    hdp::HelloParams p{
        .model = MODEL,
        .firmware = "0.1.0",
        .board = BOARD,
        .display_width = 466,
        .display_height = 466,
        .display_shape = "round",
        .color_depth = 16,
        .output_sample_rates = std::move(rates),
        .mics = 1,
        .aec = true,
        .wake_word = true,
        .inputs = {"touch"},
        .battery = std::nullopt,
        .avatar_engine = {},
        .emotes = {},
        .tools = {},
        .resume_session_id = {},
    };
    send(hdp::make_hello(p));
}

void HomunculusAgent::handle_disconnected()
{
    ESP_LOGW(TAG, "hdp disconnected");
    session_ready_ = false;
    session_id_.clear();
    stop_speaking_locally();
    set_ui(UiState::Offline);
}

void HomunculusAgent::handle_text(const std::string &text)
{
    if (!session_ready_) {
        auto m = hdp::parse_server_message(text);
        if (m.type != hdp::ServerType::Hello) {
            ESP_LOGW(TAG, "expected hello, got %s", hdp::to_string(m.type));
            send(hdp::make_goodbye("hello_required"));
            if (client_) client_->stop();
            return;
        }
        handle_hello(m);
        return;
    }

    auto m = hdp::parse_server_message(text);
    if (m.type == hdp::ServerType::Invalid) {
        ESP_LOGW(TAG, "invalid message: %s", m.error.c_str());
        return;
    }
    switch (m.type) {
    case hdp::ServerType::Hello:
        handle_hello(m);
        break;
    case hdp::ServerType::Listen:
        if (m.state == "stop") end_uplink_by_server();
        break;
    case hdp::ServerType::Stt:
        if (caption_cb_) caption_cb_(false, m.text, m.final);
        break;
    case hdp::ServerType::AgentStatus:
        if (m.phase == "thinking" || m.phase == "tool" || m.phase == "responding") {
            if (ui_ != UiState::Speaking) set_ui(UiState::Thinking);
        } else if (m.phase == "done" && ui_ == UiState::Thinking) {
            set_ui(UiState::Idle);
        } else if (m.phase == "error") {
            set_ui(UiState::Idle);
        }
        break;
    case hdp::ServerType::Tts:
        handle_tts(m);
        break;
    case hdp::ServerType::Avatar:
        // Avatar rendering is Phase 2; just log for now.
        break;
    case hdp::ServerType::ToolCall:
        handle_tool_call(m);
        break;
    case hdp::ServerType::ConfirmRequest:
        // Phase 3: for now acknowledge with yes.
        send(hdp::make_tool_result(boost::json::value(m.session_id), hdp::text_content("confirmed")));
        break;
    case hdp::ServerType::Notify:
        if (caption_cb_) caption_cb_(true, m.text, true);
        break;
    case hdp::ServerType::Config:
        break;
    case hdp::ServerType::Error:
        ESP_LOGW(TAG, "server error %s: %s", m.code.c_str(), m.message.c_str());
        set_ui(UiState::Idle);
        break;
    default:
        break;
    }
}

void HomunculusAgent::handle_hello(const hdp::ServerMessage &m)
{
    session_id_ = m.session_id;
    downlink_rate_ = m.sample_rate;
    session_ready_ = true;
    ESP_LOGI(TAG, "session %s sample_rate %u format %s", session_id_.c_str(), m.sample_rate, m.format.c_str());
    set_ui(UiState::Idle);
}

void HomunculusAgent::handle_tts(const hdp::ServerMessage &m)
{
    if (m.state == "start") {
        {
            std::lock_guard lock(player_mutex_);
            accept_downlink_ = true;
            dl_generation_++;
        }
        set_ui(UiState::Speaking);
        return;
    }
    if (m.state == "segment_start") {
        if (caption_cb_ && !m.text.empty()) caption_cb_(true, m.text, false);
        return;
    }
    if (m.state == "segment_end") {
        if (m.segment_id) player_segment_end(*m.segment_id);
        return;
    }
    if (m.state == "stop") {
        player_tts_stop();
        speech_finished();
    }
}

void HomunculusAgent::handle_tool_call(const hdp::ServerMessage &m)
{
    ESP_LOGI(TAG, "tool.call %s", m.tool_name.c_str());
    // Phase 3 device bridge: report not-implemented for now.
    send(hdp::make_tool_error(m.rpc_id, -32601, "device tool not implemented"));
}

void HomunculusAgent::send(const std::string &text)
{
    if (client_ && client_->is_connected()) {
        if (!client_->send_text(text, 200)) {
            ESP_LOGW(TAG, "send_text failed");
        }
    }
}

// ---------------------------------------------------------------------------
// Uplink

void HomunculusAgent::start_listen(const char *trigger, const char *abort_reason)
{
    if (!session_ready_ || ui_ == UiState::Listening) return;

    if (abort_reason) {
        send(hdp::make_abort(abort_reason));
        stop_speaking_locally();
    }

    {
        std::lock_guard lock(uplink_mutex_);
        uplink_active_ = true;
        uplink_end_pending_ = false;
        stream_id_++;
        uplink_seq_ = 0;
        uplink_buf_.clear();
        listen_start_us_ = esp_timer_get_time();
    }

    stats_ = TurnStats{};
    stats_.listen_start_us = esp_timer_get_time();
    listen_deadline_us_ = stats_.listen_start_us + static_cast<int64_t>(CONFIG_HOMUNCULUS_MAX_UTTERANCE_MS) * 1000;
    thinking_deadline_us_ = 0;

    send(hdp::make_listen_start("auto", trigger, ""));
    set_ui(UiState::Listening);
}

void HomunculusAgent::end_uplink_by_server()
{
    std::lock_guard lock(uplink_mutex_);
    if (!uplink_active_) return;
    uplink_end_pending_ = true;
    uplink_done_deadline_us_ = esp_timer_get_time() + 200 * 1000;
}

void HomunculusAgent::end_uplink_by_device(const char *why)
{
    std::lock_guard lock(uplink_mutex_);
    if (!uplink_active_ || uplink_end_pending_) return;
    uplink_end_pending_ = true;
    stats_.uplink_end = why;
    stats_.uplink_end_us = esp_timer_get_time();
    uplink_done_deadline_us_ = esp_timer_get_time() + 100 * 1000;
    listen_deadline_us_ = 0;
}

void HomunculusAgent::uplink_done()
{
    {
        std::lock_guard lock(uplink_mutex_);
        if (uplink_active_ || uplink_end_pending_) return;
    }
    set_ui(UiState::Thinking);
    thinking_deadline_us_ = esp_timer_get_time() + static_cast<int64_t>(CONFIG_HOMUNCULUS_THINKING_TIMEOUT_MS) * 1000;
    log_turn_stats();
}

void HomunculusAgent::stop_speaking_locally()
{
    {
        std::lock_guard lock(player_mutex_);
        dl_queue_.clear();
        dl_segments_ended_.clear();
        dl_segment_play_end_.clear();
        dl_played_due_.clear();
        accept_downlink_ = false;
        dl_generation_++;
    }
    set_ui(UiState::Idle);
}

void HomunculusAgent::speech_finished()
{
    set_ui(UiState::Idle);
}

// ---------------------------------------------------------------------------
// Downlink player

void HomunculusAgent::handle_binary(const uint8_t *data, size_t len)
{
    auto frame = hdp::decode_frame(data, len);
    if (!frame) {
        ESP_LOGW(TAG, "bad downlink frame");
        return;
    }
    if (frame->type != hdp::FRAME_OPUS_DOWNLINK) {
        ESP_LOGW(TAG, "unexpected downlink frame type %u", frame->type);
        return;
    }

    DownlinkFrame df{
        .segment = frame->stream_id,
        .flags = frame->flags,
        .data = std::vector<uint8_t>(frame->payload, frame->payload + frame->payload_len),
    };
    {
        std::lock_guard lock(player_mutex_);
        if (!accept_downlink_) {
            stats_.dl_dropped++;
            return;
        }
        dl_queue_.push_back(std::move(df));
    }
    player_cv_.notify_one();
}

void HomunculusAgent::player_loop()
{
    ESP_LOGI(TAG, "player start");
    while (running_) {
        std::unique_lock lock(player_mutex_);
        player_cv_.wait_for(lock, std::chrono::milliseconds(20),
                            [this] { return !dl_queue_.empty() || !running_ || dl_stop_after_drain_; });

        if (!running_) break;

        std::deque<DownlinkFrame> q;
        q.swap(dl_queue_);
        const uint32_t gen = dl_generation_;
        const bool stop_after_drain = dl_stop_after_drain_;
        dl_stop_after_drain_ = false;
        lock.unlock();

        if (stats_.tts_start_us == 0) stats_.tts_start_us = esp_timer_get_time();
        if (stats_.first_rx_us == 0) stats_.first_rx_us = esp_timer_get_time();

        for (auto &df : q) {
            if (gen != dl_generation_) break;  // generation bumped by barge-in

            // Feed the base-class playback operation. Base::feed_audio_decoder_data()
            // is synchronous and handles decoding + speaker output.
            if (!feed_audio_decoder_data(df.data.data(), df.data.size())) {
                stats_.dl_underruns++;
            } else {
                stats_.dl_frames++;
                if (stats_.first_fed_us == 0) stats_.first_fed_us = esp_timer_get_time();
            }

            // Each HDP frame carries one 60 ms Opus frame from the server pacer.
            {
                std::lock_guard lock(player_mutex_);
                dl_segment_play_end_[df.segment] += FRAME_US;
            }

            if (df.flags & hdp::FLAG_LAST) {
                player_segment_end(df.segment);
            }
        }

        if (stop_after_drain && q.empty()) {
            speech_finished();
        }
    }
    ESP_LOGI(TAG, "player end");
}

void HomunculusAgent::player_flush()
{
    std::lock_guard lock(player_mutex_);
    dl_queue_.clear();
}

void HomunculusAgent::player_segment_end(uint16_t segment)
{
    std::lock_guard lock(player_mutex_);
    dl_segments_ended_.insert(segment);
    const int64_t due = esp_timer_get_time() + dl_segment_play_end_[segment];
    dl_played_due_.push_back({segment, due});
}

void HomunculusAgent::player_tts_stop()
{
    std::lock_guard lock(player_mutex_);
    dl_stop_after_drain_ = true;
    player_cv_.notify_one();
}

// ---------------------------------------------------------------------------
// Statistics

void HomunculusAgent::log_turn_stats()
{
#if CONFIG_HOMUNCULUS_TURN_STATS
    std::lock_guard lock(stats_mutex_);
    const int64_t now = esp_timer_get_time();
    ESP_LOGI(TAG,
             "turn stats: listen=%lld ms, uplink_end=%s, tts_start=%lld ms, first_rx=%lld ms, "
             "first_fed=%lld ms, up_frames=%u, up_bytes=%u, up_send_fail=%u, up_gap_max=%lld ms, "
             "dl_frames=%u, dl_dropped=%u, dl_underruns=%u",
             (stats_.listen_start_us > 0 ? (now - stats_.listen_start_us) / 1000 : 0), stats_.uplink_end,
             (stats_.tts_start_us > 0 ? (stats_.tts_start_us - stats_.listen_start_us) / 1000 : 0),
             (stats_.first_rx_us > 0 ? (stats_.first_rx_us - stats_.listen_start_us) / 1000 : 0),
             (stats_.first_fed_us > 0 ? (stats_.first_fed_us - stats_.listen_start_us) / 1000 : 0),
             stats_.up_frames, stats_.up_bytes, stats_.up_send_fail, stats_.up_gap_max_us / 1000, stats_.dl_frames,
             stats_.dl_dropped, stats_.dl_underruns);
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
