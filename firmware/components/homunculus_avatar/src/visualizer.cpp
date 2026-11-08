// Circular audio-output visualizer (spec 06 §6.3): reference-lane tap, render thread,
// state palettes. Rasterisation: ring_renderer.cpp.
#include "homunculus/visualizer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <new>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_pthread.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "brookesia/service_audio/service_audio.hpp"
#include "ring_renderer.hpp"
#include "sdkconfig.h"

namespace homunculus {

namespace {

constexpr const char *TAG = "hom_vis";
constexpr int IDLE_POLL_MS = 50;

ring::Palette palette_for(UiState s)
{
    switch (s) {
    case UiState::Offline: return {{0x303030, 0x606060, 0x909090}, 0.6f};
    case UiState::Idle: return {{0x00a050, 0x40e080, 0xc0ffd0}, 0.45f};
    case UiState::Listening: return {{0x00c060, 0x60ff90, 0xe0ffe0}, 1.0f};
    case UiState::Thinking: return {{0x1040e0, 0x30a0ff, 0xc0e8ff}, 1.0f};
    case UiState::Speaking: return {{0xc020e0, 0x6f8af6, 0xe9dbfc}, 1.0f};
    }
    return {{0x303030, 0x606060, 0x909090}, 0.6f};
}

std::thread spawn(const char *name, size_t stack, int prio, std::function<void()> fn)
{
    esp_pthread_cfg_t saved = esp_pthread_get_default_config();
    const bool had_cfg = esp_pthread_get_cfg(&saved) == ESP_OK;
    esp_pthread_cfg_t cfg = esp_pthread_get_default_config();
    cfg.stack_size = stack;
    cfg.prio = prio;
    cfg.thread_name = name;
    cfg.pin_to_core = tskNO_AFFINITY;
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

Visualizer &Visualizer::get_instance()
{
    static Visualizer instance;
    return instance;
}

void Visualizer::set_state(UiState s)
{
    state_.store(s);
}

std::string Visualizer::take_stats()
{
    const uint32_t n = frames_.exchange(0);
    const uint32_t sum = frame_us_sum_.exchange(0);
    const uint32_t max = frame_us_max_.exchange(0);
    const uint32_t flush = flush_us_sum_.exchange(0);
    const uint32_t rows = rows_.exchange(0);
    char buf[112];
    std::snprintf(buf, sizeof(buf), "%u frames, avg %.1f ms (flush %.1f ms, %u rows), max %.1f ms",
                  static_cast<unsigned>(n), n ? sum / n / 1000.0 : 0.0, n ? flush / n / 1000.0 : 0.0,
                  static_cast<unsigned>(n ? rows / n : 0), max / 1000.0);
    return buf;
}

void Visualizer::inject_test_tone(uint32_t ms)
{
    test_tone_until_us_ = esp_timer_get_time() + static_cast<int64_t>(ms) * 1000;
}

bool Visualizer::start(esp_brookesia::hal::display::PanelIface *panel)
{
    if (!panel) return false;
    const auto &info = panel->get_info();
    if (info.get_pixel_bits() != 16 || info.h_res % 2 != 0) {
        ESP_LOGE(TAG, "unsupported panel %ux%u, %u bpp", info.h_res, info.v_res, info.get_pixel_bits());
        return false;
    }
    panel_ = panel;

#if defined(CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_MIC_LAYOUT) && \
    defined(CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_BITS) &&     \
    defined(CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_CHANNELS)
    const std::string layout = CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_MIC_LAYOUT;
    stride_ = CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_BITS / 16 *
              CONFIG_BROOKESIA_HAL_ADAPTOR_AUDIO_CODEC_RECORDER_CHANNELS;
#else
    const std::string layout = "RMNN";
    stride_ = 4;
#endif
    const size_t ref = layout.find('R');
    if (ref == std::string::npos || ref >= stride_) {
        ESP_LOGW(TAG, "mic layout '%s' has no reference lane; ring stays flat", layout.c_str());
    } else {
        lane_ = ref;
        auto *encoder = esp_brookesia::service::AudioEncoder::get_instance(0);
        if (encoder) {
            recorder_connection_ = encoder->connect_recorder_data(
                [this](const esp_brookesia::service::RawBuffer &b) { on_recorder_data(b.data_ptr, b.data_size); });
        } else {
            ESP_LOGW(TAG, "no AudioEncoder 0; ring stays flat");
        }
        ESP_LOGI(TAG, "reference lane %u of %u (layout %s)", static_cast<unsigned>(lane_),
                 static_cast<unsigned>(stride_), layout.c_str());
    }

    thread_ = spawn("hom_vis", 6 * 1024, 6, [this] { render_loop(); });
    return true;
}

void Visualizer::on_recorder_data(const uint8_t *data, size_t size)
{
    // Recorder task: copy the reference lane only.
    const auto *s = reinterpret_cast<const int16_t *>(data);
    const size_t frames = size / (2 * stride_);
    uint32_t w = ring_w_.load(std::memory_order_relaxed);
    for (size_t i = 0; i < frames; i++) {
        ring_[w++ % RING] = s[i * stride_ + lane_];
    }
    ring_w_.store(w, std::memory_order_release);
}

void Visualizer::render_loop()
{
    const auto &info = panel_->get_info();
    const int W = info.h_res, H = info.v_res;
    auto *intensity = static_cast<uint8_t *>(heap_caps_malloc(ring::BAND * W / 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    auto *colour = static_cast<uint8_t *>(heap_caps_malloc(ring::BAND * W / 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    // Full framebuffer in PSRAM (434 KB at 466²). Dirty rows are copied through an internal DMA
    // buffer of BAND rows and sent as full-width transfers: direct DMA from PSRAM through the
    // panel driver timed out (and then asserted in spi_device_release_bus).
    auto *fb = static_cast<uint16_t *>(heap_caps_calloc(W * H, 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    auto *tx = static_cast<uint16_t *>(heap_caps_malloc(ring::BAND * W * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL));
    if (!intensity || !colour || !fb || !tx) {
        ESP_LOGE(TAG, "buffer allocation failed");
        return;
    }
    auto flush = [&](int y1, int y2) {
        const int64_t t = esp_timer_get_time();
        for (int y = y1 & ~1; y < y2; y += ring::BAND) {
            const int rows = std::min(ring::BAND, H - y);
            std::memcpy(tx, fb + y * W, rows * W * 2);
            panel_->draw_bitmap_sync(0, y, W, y + rows, reinterpret_cast<const uint8_t *>(tx), 100);
            rows_ += static_cast<uint32_t>(rows);
        }
        flush_us_sum_ += static_cast<uint32_t>(esp_timer_get_time() - t);
    };
    flush(0, H);  // clear
    flush_us_sum_ = 0;
    rows_ = 0;

    // Renderer state (~5 KB) and the sample window in PSRAM: internal RAM is the scarce resource.
    void *mem = heap_caps_malloc(sizeof(ring::Renderer), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    auto *window = static_cast<int16_t *>(heap_caps_malloc(ring::WINDOW * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!mem || !window) {
        ESP_LOGE(TAG, "renderer allocation failed");
        return;
    }
    auto *renderer = new (mem) ring::Renderer(W, H, intensity, colour, fb);
    const float gate = 32768.0f * std::pow(10.0f, CONFIG_HOMUNCULUS_VIS_GATE_DBFS / 20.0f);
    const int64_t period_us = 1000000 / CONFIG_HOMUNCULUS_VIS_FPS;
    UiState shown = UiState::Offline;
    renderer->set_palette(palette_for(shown));
    bool flat_drawn = false;  // the flat ring for `shown` is on screen
    int64_t next_us = esp_timer_get_time();
    int64_t last_update_us = next_us;

    while (true) {
        const uint32_t w = ring_w_.load(std::memory_order_acquire);
        if (esp_timer_get_time() < test_tone_until_us_) {
            // 180 / 720 / 2100 Hz mix, phase advancing with time (development console `v`).
            const float t0 = esp_timer_get_time() / 1e6f;
            for (int i = 0; i < ring::WINDOW; i++) {
                const float t = t0 + i / 16000.0f;
                window[i] = static_cast<int16_t>(8000 * (0.6f * std::sin(2 * 3.14159f * 180 * t) +
                                                         0.3f * std::sin(2 * 3.14159f * 720 * t) +
                                                         0.1f * std::sin(2 * 3.14159f * 2100 * t)));
            }
        } else {
            for (int i = 0; i < ring::WINDOW; i++) {
                window[i] = w >= ring::WINDOW ? ring_[(w - ring::WINDOW + i) % RING] : 0;
            }
        }
        const int64_t now_us = esp_timer_get_time();
        const float dt = std::clamp((now_us - last_update_us) / 1e6f, 0.001f, 0.2f);
        last_update_us = now_us;
        const float max_disp = renderer->update(window, gate, dt);

        const UiState state = state_.load();
        const bool state_changed = state != shown;
        if (state_changed) {
            shown = state;
            renderer->set_palette(palette_for(shown));
        }
        if (max_disp == 0 && flat_drawn && !state_changed) {
            vTaskDelay(pdMS_TO_TICKS(IDLE_POLL_MS));
            next_us = esp_timer_get_time();
            continue;
        }

        const int64_t t0 = esp_timer_get_time();
        const ring::Rows dirty = renderer->render();
        if (dirty.y1 < dirty.y2) flush(dirty.y1, dirty.y2);
        flat_drawn = max_disp == 0;
        const auto frame_us = static_cast<uint32_t>(esp_timer_get_time() - t0);
        frames_++;
        frame_us_sum_ += frame_us;
        if (frame_us > frame_us_max_) frame_us_max_ = frame_us;

        next_us += period_us;
        const int64_t now = esp_timer_get_time();
        if (next_us < now) next_us = now;
        vTaskDelay(std::max<TickType_t>(1, pdMS_TO_TICKS((next_us - now) / 1000)));
    }
}

}  // namespace homunculus
