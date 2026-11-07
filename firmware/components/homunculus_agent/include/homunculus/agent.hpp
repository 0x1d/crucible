// HomunculusAgent: ESP-Brookesia agent (agent_manager `agent::Base`) speaking HDP/1
// to the Homunculus server (spec 03 §3.2.1, spec 04).
//
// Brookesia owns the audio pipeline (AFE + Opus encoder, Opus decoder + ES8311);
// this agent maps it onto HDP:
//   wake word / touch -> listen.start, AFE Opus frames -> binary 0x01 uplink
//   until server listen.stop; tts framing + binary 0x02 downlink -> jitter
//   buffer -> decoder; tts.played per segment; tool.call -> tool.result.
// Barge-in while speaking: wake word (AFE WakeStart / Brookesia InterruptSpeaking)
// or touch -> abort + flush playback + new listen.start. No VAD barge-in (spec R-06).
//
// Threads: a worker thread owns all turn state (HDP messages, UI state, timers);
// a player thread feeds the decoder; the Brookesia encoder thread sends uplink
// frames; the WebSocket task only posts work to the worker.
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
    static constexpr const char *FIRMWARE = "0.1.0";

    using StateCallback = std::function<void(UiState)>;
    // is_agent: true = agent speech (tts segment text), false = user transcript (stt).
    using CaptionCallback = std::function<void(bool is_agent, const std::string &text, bool final)>;

    static HomunculusAgent &get_instance();

    // Set before the agent starts; invoked from the agent worker thread.
    void set_state_callback(StateCallback cb);
    void set_caption_callback(CaptionCallback cb);

    // Tap on the screen: start listening, end the utterance while listening,
    // or barge in while thinking / speaking.
    void touch();
    // Same handling as a detected wake word (development console).
    void simulate_wake_word();

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

    void connect();
    void handle_connected();
    void handle_disconnected();
    void handle_text(const std::string &text);
    void handle_hello(const hdp::ServerMessage &m);
    void handle_tts(const hdp::ServerMessage &m);
    void handle_tool_call(const hdp::ServerMessage &m);
    void send(const std::string &text);

    void on_wake_word();
    void start_listen(const char *trigger, const char *wake_word, const char *abort_reason);
    void end_uplink(bool by_device, const char *why);
    void abort_uplink();
    void uplink_done(uint16_t stream_id, bool last_sent);
    void stop_playback();
    void speech_finished(uint32_t generation);
    void to_idle();

    // Downlink player thread
    struct DownlinkFrame {
        uint16_t segment;
        uint8_t flags;
        std::vector<uint8_t> data;
    };
    void handle_binary(const uint8_t *data, size_t len);
    void player_loop();
    // player_mutex_ held
    void player_reset_locked();
    void player_check_segment_locked(uint16_t segment);

    // Turn statistics
    void log_uplink_stats();
    void log_turn_stats();

    std::shared_ptr<HdpClient> client_;  // written by the worker under uplink_mutex_
    StateCallback state_cb_;
    CaptionCallback caption_cb_;
    std::atomic<UiState> ui_{UiState::Offline};
    std::string wake_word_ = "computer";

    // worker
    std::mutex work_mutex_;
    std::condition_variable work_cv_;
    std::deque<std::function<void()>> work_;
    std::thread worker_;
    std::thread player_;
    std::atomic<bool> running_{false};
    bool url_rejected_ = false;

    // session (worker)
    std::atomic<bool> session_ready_{false};
    std::string session_id_;  // kept across reconnects for hello.resume
    int64_t listen_deadline_us_ = 0;
    int64_t thinking_deadline_us_ = 0;
    int64_t uplink_done_deadline_us_ = 0;
    bool server_idle_ = false;  // last server avatar state was idle

    // uplink (worker + encoder thread)
    std::mutex uplink_mutex_;
    bool uplink_active_ = false;
    bool uplink_end_pending_ = false;
    bool uplink_end_by_device_ = false;
    uint16_t stream_id_ = 0;
    uint32_t uplink_seq_ = 0;

    // downlink (worker + player thread), player_mutex_
    std::mutex player_mutex_;
    std::condition_variable player_cv_;
    bool accept_downlink_ = false;
    std::deque<DownlinkFrame> dl_queue_;
    std::set<uint16_t> dl_segments_ended_;
    std::set<uint16_t> dl_segments_reported_;
    std::map<uint16_t, int64_t> dl_segment_play_end_;
    std::vector<std::pair<uint16_t, int64_t>> dl_played_due_;
    bool dl_primed_ = false;
    bool dl_stop_pending_ = false;
    uint32_t dl_generation_ = 0;
    int64_t dl_play_end_us_ = 0;
    std::atomic<int64_t> dl_frame_us_{60 * 1000};

    // stats, stats_mutex_
    struct TurnStats {
        int64_t listen_start_us = 0;
        int64_t uplink_end_us = 0;  // listen.stop received / device end
        int64_t tts_start_us = 0;
        int64_t first_rx_us = 0;
        int64_t first_fed_us = 0;
        int64_t play_end_us = 0;
        int64_t last_frame_us = 0;
        uint32_t up_frames = 0;
        uint32_t up_bytes = 0;
        uint32_t up_send_fail = 0;
        int64_t up_gap_max_us = 0;
        int64_t up_send_max_us = 0;
        uint32_t dl_frames = 0;
        uint32_t dl_dropped = 0;
        uint32_t dl_underruns = 0;
        uint32_t dl_feed_fail = 0;
        const char *uplink_end = "";
    };
    std::mutex stats_mutex_;
    TurnStats stats_;

    esp_brookesia::lib_utils::scoped_connection afe_connection_;
};

}  // namespace homunculus
