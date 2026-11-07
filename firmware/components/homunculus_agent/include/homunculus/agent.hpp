// HomunculusAgent: ESP-Brookesia agent (agent_manager `agent::Base`) speaking HDP/1
// to the Homunculus server (spec 03 §3.2.1, spec 04).
//
// Brookesia owns the audio pipeline (AFE + Opus encoder, Opus decoder + ES8311);
// this agent maps it onto HDP:
//   wake word / touch -> listen.start, AFE Opus frames -> binary 0x01 uplink
//   until server listen.stop; tts framing + binary 0x02 downlink -> jitter
//   buffer -> decoder; tts.played per segment; tool.call -> tool.result.
// Barge-in while speaking: wake word (Brookesia InterruptSpeaking) or touch
// -> abort + flush playback + new listen.start. No VAD barge-in (spec R-06).
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>
#include "brookesia/agent_manager/base.hpp"
#include "brookesia/lib_utils/signal.hpp"
#include "homunculus/hdp.hpp"

namespace homunculus {

class HdpClient;

// Coarse device state for the display (spec 03 §3.2.4 subset).
enum class UiState {
    Offline,    // no Wi-Fi / no HDP session
    Idle,
    Listening,
    Thinking,
    Speaking,
};
const char *to_string(UiState s);

class HomunculusAgent : public esp_brookesia::agent::Base {
public:
    static constexpr const char *NAME = "Homunculus";
    static constexpr const char *MODEL = "ws-s3-amoled-175c";
    static constexpr const char *BOARD = "waveshare/esp32_s3_touch_amoled_1_75c";

    using StateCallback = std::function<void(UiState)>;
    // is_agent: true = agent speech (tts segment text), false = user transcript (stt).
    using CaptionCallback = std::function<void(bool is_agent, const std::string &text, bool final)>;

    static HomunculusAgent &get_instance();

    // Set before the agent starts; invoked from the agent worker thread.
    void set_state_callback(StateCallback cb);
    void set_caption_callback(CaptionCallback cb);

    // Tap on the screen: start listening, end the utterance while listening,
    // or barge in while speaking.
    void touch();

    UiState ui_state() const
    {
        return ui_.load();
    }

private:
    HomunculusAgent();
    ~HomunculusAgent() override = default;

    // agent::Base hooks
    bool on_activate() override;
    bool on_startup() override;
    void on_shutdown() override;
    bool on_sleep() override;
    bool on_wakeup() override;
    bool on_interrupt_speaking() override;
    bool on_encoder_data_ready(const uint8_t *data, size_t data_size) override;

    // Worker thread (all turn state changes happen here)
    void post(std::function<void()> fn);
    void worker_loop();
    void tick();
    void set_ui(UiState s);

    void handle_connected();
    void handle_disconnected();
    void handle_text(const std::string &text);
    void handle_hello(const hdp::ServerMessage &m);
    void handle_tts(const hdp::ServerMessage &m);
    void handle_tool_call(const hdp::ServerMessage &m);
    void send(const std::string &text);

    void start_listen(const char *trigger, const char *abort_reason);
    void end_uplink_by_server();
    void end_uplink_by_device(const char *why);
    void uplink_done();
    void stop_speaking_locally();
    void speech_finished();
    void on_afe_event(const std::string &event);

    // Downlink player thread
    struct DownlinkFrame {
        uint16_t segment;
        uint8_t flags;
        std::vector<uint8_t> data;
    };
    void handle_binary(const uint8_t *data, size_t len);
    void player_loop();
    void player_flush();
    void player_segment_end(uint16_t segment);
    void player_tts_stop();
    void reopen_decoder_stream(uint32_t sample_rate);

    // Turn statistics
    void log_turn_stats();

    std::unique_ptr<HdpClient> client_;
    StateCallback state_cb_;
    CaptionCallback caption_cb_;
    std::atomic<UiState> ui_{UiState::Offline};

    // worker
    std::mutex work_mutex_;
    std::condition_variable work_cv_;
    std::deque<std::function<void()>> work_;
    std::thread worker_;
    std::thread player_;
    std::atomic<bool> running_{false};

    // session (worker)
    std::atomic<bool> session_ready_{false};
    std::string session_id_;
    uint32_t downlink_rate_ = 24000;
    uint32_t decoder_rate_ = 24000;
    std::string decoder_source_;
    int volume_ = 100;
    int64_t listen_deadline_us_ = 0;
    int64_t thinking_deadline_us_ = 0;
    int64_t uplink_done_deadline_us_ = 0;

    // uplink (worker + encoder thread)
    std::mutex uplink_mutex_;
    bool uplink_active_ = false;
    bool uplink_end_pending_ = false;
    uint16_t stream_id_ = 0;
    uint32_t uplink_seq_ = 0;
    std::vector<uint8_t> uplink_buf_;
    std::atomic<bool> vad_speech_{false};
    int64_t listen_start_us_ = 0;

    // downlink (ws thread + worker + player thread)
    std::atomic<bool> accept_downlink_{false};
    std::mutex player_mutex_;
    std::condition_variable player_cv_;
    std::deque<DownlinkFrame> dl_queue_;
    std::set<uint16_t> dl_segments_ended_;
    std::map<uint16_t, int64_t> dl_segment_play_end_;  // fully fed segments: estimated end of playback
    std::vector<std::pair<uint16_t, int64_t>> dl_played_due_;
    bool dl_primed_ = false;
    bool dl_stop_after_drain_ = false;
    uint32_t dl_generation_ = 0;
    int64_t dl_play_end_us_ = 0;

    // stats
    struct TurnStats {
        int64_t listen_start_us = 0;
        int64_t uplink_end_us = 0;
        int64_t tts_start_us = 0;
        int64_t first_rx_us = 0;
        int64_t first_fed_us = 0;
        int64_t last_frame_us = 0;
        uint32_t up_frames = 0;
        uint32_t up_bytes = 0;
        uint32_t up_send_fail = 0;
        int64_t up_gap_max_us = 0;
        int64_t up_gap_sum_us = 0;
        int64_t up_send_max_us = 0;
        uint32_t dl_frames = 0;
        uint32_t dl_dropped = 0;
        uint32_t dl_underruns = 0;
        const char *uplink_end = "";
    };
    std::mutex stats_mutex_;
    TurnStats stats_;

    esp_brookesia::lib_utils::scoped_connection afe_connection_;
};

}  // namespace homunculus
