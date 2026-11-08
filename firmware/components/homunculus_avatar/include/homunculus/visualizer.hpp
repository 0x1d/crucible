// Phase 2 display (spec 06): circular waveform of the device's audio output.
//
// Source: the DAC reference lane ('R' in the recorder mic layout) of the raw recorder
// data published by the Brookesia AudioEncoder service, i.e. the speaker signal as the
// AEC sees it. Rendering: mirrored closed waveform around a base circle, colour per
// UI state, rasterised in 10-row bands straight to the panel (no LVGL).
#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include "brookesia/hal_interface.hpp"
#include "brookesia/lib_utils/signal.hpp"
#include "homunculus/agent.hpp"

namespace homunculus {

class Visualizer {
public:
    static Visualizer &get_instance();

    // Clears the screen, subscribes to the recorder data and starts the render thread, which
    // then owns all drawing. The caller keeps the panel interface alive. Requires a 16-bit
    // panel with even width; false otherwise.
    bool start(esp_brookesia::hal::display::PanelIface *panel);
    void set_state(UiState s);

    // Full-screen cards replace the ring until hide_card() (spec 06 §6.6). Any thread.
    // Confirmation: title, detail, deny / approve buttons. Text: centred text only.
    void show_confirm_card(const std::string &title, const std::string &detail);
    void show_text_card(const std::string &text);
    void hide_card();

    // Frames, average/max frame time, flush time and flushed rows since the previous call (stats log).
    std::string take_stats();

    // Development: replaces the reference lane with a synthetic speech-like tone for `ms`.
    void inject_test_tone(uint32_t ms);

private:
    Visualizer() = default;

    void on_recorder_data(const uint8_t *data, size_t size);
    void render_loop();

    esp_brookesia::hal::display::PanelIface *panel_ = nullptr;
    esp_brookesia::lib_utils::scoped_connection recorder_connection_;
    std::thread thread_;
    std::atomic<UiState> state_{UiState::Offline};

    struct Card {
        bool confirm = false;
        std::string title, detail;
    };
    std::mutex card_mutex_;
    Card card_;
    bool card_active_ = false;
    std::atomic<uint32_t> card_version_{0};
    void set_card(bool active, Card card);

    // Reference-lane ring buffer (recorder task writes, render thread reads).
    static constexpr uint32_t RING = 1024;
    int16_t ring_[RING] = {};
    std::atomic<uint32_t> ring_w_{0};
    size_t lane_ = 0;
    size_t stride_ = 4;  // int16 lanes per recorder sample frame

    // Stats (render thread writes, stats reader takes)
    std::atomic<uint32_t> frames_{0};
    std::atomic<uint32_t> frame_us_sum_{0};
    std::atomic<uint32_t> frame_us_max_{0};
    std::atomic<uint32_t> flush_us_sum_{0};
    std::atomic<uint32_t> rows_{0};
    std::atomic<int64_t> test_tone_until_us_{0};
};

}  // namespace homunculus
