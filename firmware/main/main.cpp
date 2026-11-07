// Homunculus Phase 1 voice MVP (p1d): boots the HDP/1 agent on ESP-Brookesia,
// connects to Wi-Fi, and hands wake-word / touch / audio / display over to the
// agent_manager-driven HomunculusAgent.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_pthread.h"
#define BROOKESIA_LOG_TAG "Homunculus"
#include "brookesia/agent_manager/manager.hpp"
#include "brookesia/lib_utils.hpp"
#include "brookesia/service_helper.hpp"
#include "brookesia/service_manager.hpp"
#include "brookesia/service_audio/service_audio.hpp"
#include "brookesia/hal_interface.hpp"
#include "brookesia/hal_adaptor.hpp"
#include "homunculus/agent.hpp"
#include "homunculus/wifi.hpp"

using namespace esp_brookesia;
using AudioPlaybackHelper = service::helper::AudioPlayback;

namespace {

// Acquired interfaces must stay alive: releasing the last handle deinitialises the device.
hal::InterfaceHandle<hal::display::PanelIface> g_panel;
hal::InterfaceHandle<hal::display::BacklightIface> g_backlight;
std::mutex g_draw_mutex;

// Display feedback colours (RGB) for each coarse agent UI state.
constexpr uint8_t OFFLINE[3] = {20, 20, 20};
constexpr uint8_t IDLE[3] = {0, 80, 0};         // dim green
constexpr uint8_t LISTENING[3] = {0, 255, 0};   // bright green
constexpr uint8_t THINKING[3] = {0, 60, 220};   // blue
constexpr uint8_t SPEAKING[3] = {220, 0, 220};  // magenta
constexpr uint8_t ERROR_COLOUR[3] = {255, 0, 0};

bool configure_audio_processor()
{
    hal::AudioProcessorConfig config{
        .playback = {
            .player_task = {
                .core_id = 0,
                .priority = 5,
                .stack_size = 4 * 1024,
#if CONFIG_SPIRAM_XIP_FROM_PSRAM
                .stack_in_ext = true,
#else
                .stack_in_ext = false,
#endif
            },
        },
        .encoder = {},
        .decoder = {},
        .afe = {
            .vad = hal::AudioProcessorAFE_VAD_Config{},
            .wakenet = hal::AudioProcessorAFE_WakeNetConfig{},
        },
    };
    return hal::AudioDevice::get_instance().set_processor_config(std::move(config));
}

void paint_solid(const uint8_t *c)
{
    if (!g_panel) return;
    const auto &info = g_panel->get_info();
    const uint32_t w = info.h_res, h = info.v_res;
    const uint32_t bytes_pp = info.get_pixel_bits() / 8;

    std::lock_guard lock(g_draw_mutex);
    constexpr uint32_t BAND = 16;
    std::vector<uint8_t> buf(w * BAND * bytes_pp);
    for (uint32_t y_band = 0; y_band < BAND; y_band++) {
        for (uint32_t x = 0; x < w; x++) {
            uint8_t *p = &buf[(y_band * w + x) * bytes_pp];
            if (bytes_pp == 2) {
                uint16_t v = ((c[0] & 0xF8) << 8) | ((c[1] & 0xFC) << 3) | (c[2] >> 3);
                p[0] = v >> 8;  // big-endian RGB565
                p[1] = v & 0xFF;
            } else {
                p[0] = c[0];
                p[1] = c[1];
                p[2] = c[2];
            }
        }
    }
    for (uint32_t y = 0; y < h; y += BAND) {
        g_panel->draw_bitmap(0, y, w, std::min(y + BAND, h), buf.data());
    }
}

void init_display()
{
    g_panel = hal::acquire_first_interface<hal::display::PanelIface>();
    if (!g_panel) {
        BROOKESIA_LOGE("[display] no panel interface");
        return;
    }
    const auto &info = g_panel->get_info();
    BROOKESIA_LOGI("[display] %1%x%2%, %3% bits per pixel", info.h_res, info.v_res, info.get_pixel_bits());
    paint_solid(OFFLINE);

    g_backlight = hal::acquire_first_interface<hal::display::BacklightIface>();
    if (g_backlight) {
        g_backlight->set_brightness(80);
    }
}

void show_ui_state(homunculus::UiState s)
{
    switch (s) {
    case homunculus::UiState::Offline: paint_solid(OFFLINE); break;
    case homunculus::UiState::Idle: paint_solid(IDLE); break;
    case homunculus::UiState::Listening: paint_solid(LISTENING); break;
    case homunculus::UiState::Thinking: paint_solid(THINKING); break;
    case homunculus::UiState::Speaking: paint_solid(SPEAKING); break;
    }
}

std::atomic<bool> g_touch_run{true};

void touch_task()
{
    auto touch = hal::acquire_first_interface<hal::display::TouchIface>();
    if (!touch) {
        BROOKESIA_LOGE("[touch] no touch interface");
        return;
    }
    const auto &info = touch->get_info();
    BROOKESIA_LOGI("[touch] x_max=%1% y_max=%2% points=%3%", info.x_max, info.y_max, info.max_points);

    static std::atomic<bool> pending{false};
    const bool use_irq = info.operation_mode == hal::display::TouchIface::OperationMode::Interrupt &&
                         touch->register_interrupt_handler([](void *) {
                             pending = true;
                             return false;
                         }, nullptr);
    BROOKESIA_LOGI("[touch] mode: %1%", use_irq ? "interrupt" : "polling");

    std::vector<hal::display::TouchIface::Point> points;
    bool was_down = false;
    while (g_touch_run) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        if (use_irq && !pending.exchange(false) && !was_down) {
            continue;
        }
        points.clear();
        if (!touch->read_points(points)) {
            was_down = false;
            continue;
        }
        if (!points.empty() && !was_down) {
            homunculus::HomunculusAgent::get_instance().touch();
        }
        was_down = !points.empty();
    }
}

void print_heap(const char *label)
{
    BROOKESIA_LOGI(
        "[heap] %1%: internal free %2% KB (min %3% KB), PSRAM free %4% KB (min %5% KB)", label,
        heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024, heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM) / 1024
    );
}

}  // namespace

extern "C" void app_main(void)
{
    BROOKESIA_LOGI("=== Homunculus Phase 1 voice MVP ===");
    for (const char *tag : {"ESP_GMF_TASK", "ESP_GMF_PORT", "ESP_GMF_POOL", "GMF_AFE", "ESP_GMF_AENC", "AFE_MANAGER",
                            "AUD_RENDER", "AUDIO_PROCESSOR", "AUD_SDEC", "AFE_CONFIG", "NEW_DATA_BUS"}) {
        esp_log_level_set(tag, ESP_LOG_WARN);
    }
    print_heap("boot");

    BROOKESIA_CHECK_FALSE_EXIT(configure_audio_processor(), "Failed to configure audio processor");

    auto &service_manager = service::ServiceManager::get_instance();
    BROOKESIA_CHECK_FALSE_EXIT(service_manager.start(), "Failed to start ServiceManager");

    // Set playback volume once for the whole run.
    auto vol = AudioPlaybackHelper::call_function_sync(AudioPlaybackHelper::FunctionId::SetVolume, 100.0);
    BROOKESIA_LOGI("[audio] volume 100 %%: %1%", vol ? "ok" : vol.error());

    init_display();

    // Wire display state feedback and start the touch forwarding thread.
    auto &agent = homunculus::HomunculusAgent::get_instance();
    agent.set_state_callback([](homunculus::UiState s) { show_ui_state(s); });

    auto pthread_cfg = esp_pthread_get_default_config();
    pthread_cfg.stack_size = 6 * 1024;
    pthread_cfg.thread_name = "touch";
    esp_pthread_set_cfg(&pthread_cfg);
    std::thread touch(touch_task);

    // Start Wi-Fi; the agent's worker thread opens the HDP connection once connected.
    BROOKESIA_CHECK_FALSE_EXIT(homunculus::wifi::start(), "Failed to start Wi-Fi");

    // Activate the Homunculus agent through the agent_manager state machine.
    auto &agent_manager = esp_brookesia::agent::Manager::get_instance();

    boost::json::object set_target_params;
    set_target_params["Name"] = homunculus::HomunculusAgent::NAME;
    auto target_result = agent_manager.call_function_sync("SetTargetAgent", set_target_params, 1000);
    if (!target_result.success) {
        ESP_LOGE("Homunculus", "SetTargetAgent failed: %s", target_result.error_message.c_str());
    }

    boost::json::object activate_params;
    activate_params["Action"] = "Activate";
    auto activate_result = agent_manager.call_function_sync("TriggerGeneralAction", activate_params, 1000);
    BROOKESIA_CHECK_FALSE_EXIT(activate_result.success, "Failed to activate HomunculusAgent: %s",
                               activate_result.error_message.c_str());

    print_heap("agent active");

    // Idle forever; agent threads handle all interaction.
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(10));
        print_heap("run");
    }
}
