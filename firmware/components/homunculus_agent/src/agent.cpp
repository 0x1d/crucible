// HomunculusAgent implementation (spec 03 §3.2): Brookesia agent_manager agent + HDP/1 client.
// Audio integration uses the same Brookesia helper APIs as the Phase 0 bench (firmware/main/main.cpp).
#include "homunculus/agent.hpp"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <chrono>
#include <variant>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "brookesia/service_helper.hpp"
#include "brookesia/service_manager.hpp"
#include "brookesia/service_audio/service_audio.hpp"
#include "brookesia/service_helper/media/audio.hpp"
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
constexpr const char *SOURCE_NAME = "Homunculus";
constexpr const char *OUTPUT_NAME = "Speaker0";

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
    return true;
}

bool HomunculusAgent::on_startup()
{
    ESP_LOGI(TAG, "startup");
    running_ = true;
    worker_ = std::thread(&HomunculusAgent::worker_loop, this);
    player_ = std::thread(&HomunculusAgent::player_loop, this);

    afe_connection_ = AudioEncoderHelper::subscribe_event(
        AudioEncoderHelper::EventId::AFEEventHappened,
        [this](const std::string &name, const std::string &event) { on_afe_event(event); });

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
}

bool HomunculusAgent::on_sleep()
{
    ESP_LOGI(TAG, "sleep");
    post([this] { set_ui(UiState::Offline); });
    return true;
}

bool HomunculusAgent::on_wakeup()
{
    ESP_LOGI(TAG, "wakeup");
    post([this] { set_ui(UiState::Idle); });
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
    if (!uplink_active_) return true;
    if (!data || data_size == 0) return true;

    auto frame = hdp::encode_frame(hdp::FRAME_OPUS_UPLINK, 0, stream_id_, uplink_seq_++, data, data_size);
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
        if (ui_ == UiState::Thinking && thinking_deadline_us_ > 0 && now > thinking_deadline_us_) {
            ESP_LOGW(TAG, "thinking timeout");
            stop_speaking_locally();
            set_ui(UiState::Idle);
        }
        if (uplink_done_deadline_us_ > 0 && now > uplink_done_deadline_us_) {
            uplink_done_deadline_us_ = 0;
            uplink_done();
        }
    }

    // Send tts.played events that are due.
    std::vector<uint16_t> played;
    {
        std::lock_guard lock(player_mutex_);
        const int64_t now_us = esp_timer_get_time();
        for (auto it = dl_played_due_.begin(); it != dl_played_due_.end();) {
            if (now_us >= it->second) {
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
        // First message after connect must be hello.
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
        if (m.phase == "thinking" && ui_ != UiState::Speaking) set_ui(UiState::Thinking);
        else if (m.phase == "tool" && ui_ != UiState::Speaking) set_ui(UiState::Thinking);
        else if (m.phase == "responding" && ui_ != UiState::Speaking) set_ui(UiState::Thinking);
        else if (m.phase == "done" && ui_ == UiState::Thinking) set_ui(UiState::Idle);
        else if (m.phase == "error") set_ui(UiState::Idle);
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
        reopen_decoder_stream(downlink_rate_);
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
    // Phase 3 device bridge: echo back a not-implemented error for now.
    boost::json::object err{{"code", -32601}, {"message", "device tool not implemented"}};
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

    // Start Brookesia audio encoder (AFE + Opus encode).
    AudioHelper::EncoderDynamicConfig config{
        .type = AudioHelper::CodecFormat::OPUS,
        .general = {
            .channels = 1,
            .sample_bits = 16,
            .sample_rate = 16000,
            .frame_duration = 60,
        },
        .extra = AudioHelper::EncoderExtraConfigOpus{.enable_vbr = true, .bitrate = 24000},
        .enable_afe = true,
    };
    auto r = AudioEncoderHelper::call_function_sync(
        AudioEncoderHelper::FunctionId::Start, BROOKESIA_DESCRIBE_TO_JSON(config).as_object(),
        esp_brookesia::service::helper::Timeout(1000));
    if (!r) {
        ESP_LOGE(TAG, "encoder start failed: %s", r.error().c_str());
        return;
    }
    set_encoder_paused(false);

    {
        std::lock_guard lock(uplink_mutex_);
        uplink_active_ = true;
        uplink_end_pending_ = false;
        stream_id_++;
        uplink_seq_ = 0;
        uplink_buf_.clear();
        vad_speech_ = false;
        listen_start_us_ = esp_timer_get_time();
    }

    const int64_t now = esp_timer_get_time();
    stats_ = TurnStats{};
    stats_.listen_start_us = now;
    listen_deadline_us_ = now + static_cast<int64_t>(CONFIG_HOMUNCULUS_MAX_UTTERANCE_MS) * 1000;
    thinking_deadline_us_ = 0;
    uplink_done_deadline_us_ = 0;

    send(hdp::make_listen_start("auto", trigger, ""));
    set_ui(UiState::Listening);
}

void HomunculusAgent::end_uplink_by_server()
{
    std::lock_guard lock(uplink_mutex_);
    if (!uplink_active_) return;
    uplink_end_pending_ = true;
    uplink_done_deadline_us_ = esp_timer_get_time() + 200 * 1000;  // 200 ms to flush last frame
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
        if (!uplink_active_) return;
        uplink_active_ = false;
    }

    auto r = AudioEncoderHelper::call_function_sync(AudioEncoderHelper::FunctionId::Stop,
                                                    esp_brookesia::service::helper::Timeout(1000));
    if (!r) {
        ESP_LOGW(TAG, "encoder stop failed: %s", r.error().c_str());
    }
    set_encoder_paused(true);
    set_ui(UiState::Thinking);
    thinking_deadline_us_ = esp_timer_get_time() + static_cast<int64_t>(CONFIG_HOMUNCULUS_THINKING_TIMEOUT_MS) * 1000;
    log_turn_stats();
}

void HomunculusAgent::stop_speaking_locally()
{
    player_flush();
    {
        std::lock_guard lock(player_mutex_);
        accept_downlink_ = false;
        dl_stop_after_drain_ = false;
        dl_segments_ended_.clear();
        dl_segment_play_end_.clear();
        dl_played_due_.clear();
        dl_primed_ = false;
        dl_generation_++;
    }
}

void HomunculusAgent::speech_finished()
{
    set_ui(UiState::Idle);
}

void HomunculusAgent::on_afe_event(const std::string &event)
{
    if (event == "VAD_Start") {
        vad_speech_ = true;
    } else if (event == "VAD_End") {
        vad_speech_ = false;
#if CONFIG_HOMUNCULUS_DEVICE_ENDPOINT
        if (uplink_active_ && !uplink_end_pending_) {
            const int64_t elapsed = (esp_timer_get_time() - listen_start_us_) / 1000;
            if (elapsed >= CONFIG_HOMUNCULUS_DEVICE_ENDPOINT_MIN_MS) {
                end_uplink_by_device("vad");
            }
        }
#endif
    } else if (event == "WakeStart") {
        post([this] { start_listen("wake_word", "barge_in"); });
    }
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

        if (!accept_downlink_ && dl_queue_.empty()) continue;

        auto *decoder = esp_brookesia::service::AudioDecoder::get_instance(0);
        if (!decoder) {
            lock.unlock();
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        // Prefill jitter buffer before starting playback.
        if (!dl_primed_ && dl_queue_.size() < CONFIG_HOMUNCULUS_JITTER_PREFILL_FRAMES) continue;
        dl_primed_ = true;

        if (stats_.tts_start_us == 0) stats_.tts_start_us = esp_timer_get_time();
        if (stats_.first_rx_us == 0) stats_.first_rx_us = esp_timer_get_time();

        std::deque<DownlinkFrame> q;
        q.swap(dl_queue_);
        const uint32_t gen = dl_generation_;
        lock.unlock();

        for (auto &df : q) {
            if (gen != dl_generation_) break;  // generation bumped by barge-in
            auto w = decoder->write_stream(decoder_source_, OUTPUT_NAME,
                                           esp_brookesia::service::RawBuffer(df.data.data(), df.data.size()), 1000);
            if (w != esp_brookesia::service::AudioWriteResult::Written) {
                ESP_LOGW(TAG, "decoder write failed");
                stats_.dl_underruns++;
            } else {
                stats_.dl_frames++;
                if (stats_.first_fed_us == 0) stats_.first_fed_us = esp_timer_get_time();
            }
            if (df.flags & hdp::FLAG_LAST) {
                player_segment_end(df.segment);
            }
        }

        lock.lock();
        if (dl_stop_after_drain_ && dl_queue_.empty()) {
            dl_stop_after_drain_ = false;
            speech_finished();
        }
    }
    ESP_LOGI(TAG, "player end");
}

void HomunculusAgent::player_flush()
{
    {
        std::lock_guard lock(player_mutex_);
        dl_queue_.clear();
    }
    auto *decoder = esp_brookesia::service::AudioDecoder::get_instance(0);
    if (decoder && !decoder_source_.empty()) {
        (void)decoder->close_stream(decoder_source_, OUTPUT_NAME);
    }
}

void HomunculusAgent::player_segment_end(uint16_t segment)
{
    std::lock_guard lock(player_mutex_);
    dl_segments_ended_.insert(segment);
    // Estimate playback end and schedule tts.played. Very rough: assume 16 kbit/s Opus -> ~8 kbit/s PCM.
    // Real implementation should use decoder stream position / playback callback.
    constexpr int64_t US_PER_BYTE = 250;  // ~32 kbps raw 16 kHz mono
    int64_t play_end = esp_timer_get_time();
    for (const auto &df : dl_queue_) {
        if (df.segment == segment) play_end += df.data.size() * US_PER_BYTE;
    }
    dl_segment_play_end_[segment] = play_end;
    dl_played_due_.push_back({segment, play_end});
}

void HomunculusAgent::player_tts_stop()
{
    std::lock_guard lock(player_mutex_);
    dl_stop_after_drain_ = true;
    player_cv_.notify_one();
}

void HomunculusAgent::reopen_decoder_stream(uint32_t sample_rate)
{
    player_flush();
    auto *decoder = esp_brookesia::service::AudioDecoder::get_instance(0);
    if (!decoder) {
        ESP_LOGE(TAG, "no audio decoder");
        return;
    }
    using AudioHelper = esp_brookesia::service::helper::Audio;
    (void)decoder->unregister_source(SOURCE_NAME);
    auto source = decoder->register_source(esp_brookesia::service::AudioSourceInfo{
        .name = SOURCE_NAME,
        .role = "agent",
        .preferred_outputs = {OUTPUT_NAME},
    });
    if (!source) {
        ESP_LOGE(TAG, "register_source: %s", source.error().c_str());
        return;
    }
    decoder_source_ = source.value();
    (void)decoder->request_output(decoder_source_, OUTPUT_NAME);
    (void)decoder->set_active_source(OUTPUT_NAME, SOURCE_NAME);

    decoder_rate_ = sample_rate ? sample_rate : 24000;
    auto opened = decoder->open_stream(
        decoder_source_, OUTPUT_NAME,
        esp_brookesia::service::AudioStreamConfig{
            .type = AudioHelper::CodecFormat::OPUS,
            .general = {
                .channels = 1,
                .sample_bits = 16,
                .sample_rate = decoder_rate_,
                .frame_duration = 60,
            },
        });
    if (!opened) {
        ESP_LOGE(TAG, "open_stream: %s", opened.error().c_str());
        return;
    }

    {
        std::lock_guard lock(player_mutex_);
        accept_downlink_ = true;
        dl_primed_ = false;
        dl_generation_++;
    }
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

// Static symbol references for forced linking (see CMakeLists.txt).
extern "C" void homunculus_agent_symbol()
{
}
extern "C" void homunculus_agent_service_symbol()
{
}

