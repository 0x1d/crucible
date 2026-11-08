// Homunculus Phase 1 voice MVP (p1d): boots the HDP/1 agent on ESP-Brookesia,
// connects to Wi-Fi, and hands wake-word / touch / audio / display over to the
// agent_manager-driven HomunculusAgent.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>
#include <string>
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
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
#include "sdkconfig.h"

using namespace esp_brookesia;

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
    int64_t last_tap_us = 0;
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
            // 300 ms debounce: one tap can report release/press pairs.
            const int64_t now = esp_timer_get_time();
            if (now - last_tap_us > 300 * 1000) {
                homunculus::HomunculusAgent::get_instance().touch();
            }
            last_tap_us = now;
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

// Per-core CPU load since the previous call: 100 % minus the idle task's run-time share
// (FreeRTOS run-time stats, esp_timer time base).
class CpuLoad {
public:
    // Also fills `stacks` with "name:min_free_bytes" for the Homunculus threads.
    void sample(int load_out[2], std::string &stacks)
    {
        const UBaseType_t n = uxTaskGetNumberOfTasks() + 4;
        std::vector<TaskStatus_t> tasks(n);
        configRUN_TIME_COUNTER_TYPE total = 0;
        const UBaseType_t got = uxTaskGetSystemState(tasks.data(), n, &total);
        const int64_t now = esp_timer_get_time();
        configRUN_TIME_COUNTER_TYPE idle[2] = {0, 0};
        for (UBaseType_t i = 0; i < got; i++) {
            const std::string name = tasks[i].pcTaskName;
            if (name == "hom_worker" || name == "hom_player" || name == "hdp_ws" || name == "touch" ||
                    name == "console") {
                stacks += " " + name + ":" + std::to_string(tasks[i].usStackHighWaterMark);
            }
            for (int core = 0; core < 2; core++) {
                if (tasks[i].xHandle == xTaskGetIdleTaskHandleForCore(core)) {
                    idle[core] = tasks[i].ulRunTimeCounter;
                }
            }
        }
        const int64_t dt = now - last_us_;
        for (int core = 0; core < 2; core++) {
            const int64_t di = static_cast<int64_t>(idle[core] - last_idle_[core]);
            load_out[core] = (last_us_ > 0 && dt > 0) ? static_cast<int>(100 - (di * 100) / dt) : -1;
            last_idle_[core] = idle[core];
        }
        last_us_ = now;
    }

private:
    int64_t last_us_ = 0;
    configRUN_TIME_COUNTER_TYPE last_idle_[2] = {0, 0};
};

std::mutex g_stats_mutex;
CpuLoad g_cpu_load;

void print_system_stats()
{
    std::lock_guard lock(g_stats_mutex);
    int load[2];
    std::string stacks;
    g_cpu_load.sample(load, stacks);
    BROOKESIA_LOGI(
        "[stats] ui %1%, cpu core0 %2% %%, core1 %3% %%, internal free %4% KB (min %5% KB), PSRAM free %6% KB, "
        "stack min free%7%",
        homunculus::to_string(homunculus::HomunculusAgent::get_instance().ui_state()), load[0], load[1],
        heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024, heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024,
        stacks
    );
}

#if CONFIG_HOMUNCULUS_DEV_CONSOLE
// Development console: single-key commands on the USB-Serial-JTAG console.
void console_task()
{
    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    if (usb_serial_jtag_driver_install(&cfg) == ESP_OK) {
        usb_serial_jtag_vfs_use_driver();
    }
    BROOKESIA_LOGI("[console] keys: t = touch, w = wake word, s = stats, r = HDP reconnect, d = Wi-Fi disconnect");
    auto &agent = homunculus::HomunculusAgent::get_instance();
    while (true) {
        uint8_t c = 0;
        if (usb_serial_jtag_read_bytes(&c, 1, pdMS_TO_TICKS(1000)) <= 0) {
            continue;
        }
        switch (c) {
        case 't':
            BROOKESIA_LOGI("[console] touch");
            agent.touch();
            break;
        case 'w':
            BROOKESIA_LOGI("[console] wake word");
            agent.simulate_wake_word();
            break;
        case 's':
            print_system_stats();
            break;
        case 'r':
            BROOKESIA_LOGI("[console] HDP reconnect");
            agent.reconnect();
            break;
        case 'd':
            BROOKESIA_LOGI("[console] Wi-Fi disconnect (auto-reconnects)");
            esp_wifi_disconnect();
            break;
        default:
            break;
        }
    }
}
#endif

// Polls the AgentManager general state (e.g. "Activated") until it matches or times out.
bool wait_general_state(agent::Manager &manager, const char *state, int timeout_ms)
{
    for (int t = 0; t < timeout_ms; t += 20) {
        auto r = manager.call_function_sync("GetGeneralState", boost::json::object{}, 500);
        if (r.success && r.has_data() && r.get_data<std::string>() == state) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return false;
}

void start_thread(const char *name, size_t stack, void (*fn)())
{
    auto cfg = esp_pthread_get_default_config();
    cfg.stack_size = stack;
    cfg.thread_name = name;
    esp_pthread_set_cfg(&cfg);
    std::thread(fn).detach();
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

    // Speaker volume (Brookesia default 75 % is too quiet on the 1.75C).
    using AudioPlaybackHelper = service::helper::AudioPlayback;
    auto playback_binding = service_manager.bind(AudioPlaybackHelper::get_name().data());
    if (playback_binding.is_valid()) {
        auto vol = AudioPlaybackHelper::call_function_sync(AudioPlaybackHelper::FunctionId::SetVolume,
                                                           static_cast<double>(CONFIG_HOMUNCULUS_SPEAKER_VOLUME));
        BROOKESIA_LOGI("[audio] volume %1% %%: %2%", CONFIG_HOMUNCULUS_SPEAKER_VOLUME, vol ? "ok" : vol.error());
    } else {
        BROOKESIA_LOGW("[audio] AudioPlayback bind failed; volume unchanged");
    }

    // Start the AgentManager service so its functions can be called.
    auto agent_manager_binding = service_manager.bind("AgentManager");
    BROOKESIA_CHECK_FALSE_EXIT(agent_manager_binding.is_valid(), "Failed to bind AgentManager");

    init_display();

    // Wire display state feedback before activation so boot states are visible.
    auto &agent = homunculus::HomunculusAgent::get_instance();
    agent.set_state_callback([](homunculus::UiState s) { show_ui_state(s); });

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

    // RealTime: Brookesia does not gate encoder data / decoder writes on the speaking /
    // listening flags (HalfDuplex, the Kconfig default, would); the agent gates the uplink itself.
    boost::json::object chat_mode_params;
    chat_mode_params["Mode"] = "RealTime";
    auto mode_result = agent_manager.call_function_sync("SetChatMode", chat_mode_params, 1000);
    if (!mode_result.success) {
        ESP_LOGE("Homunculus", "SetChatMode failed: %s", mode_result.error_message.c_str());
    }

    boost::json::object activate_params;
    activate_params["Action"] = "Activate";
    auto activate_result = agent_manager.call_function_sync("TriggerGeneralAction", activate_params, 1000);
    BROOKESIA_CHECK_FALSE_EXIT(activate_result.success, "Failed to activate HomunculusAgent: %s",
                               activate_result.error_message.c_str());

    // Start only once Activated: StateMachine::trigger_general_action() reads the front of an
    // empty action queue when an action is triggered while a transition is still running.
    BROOKESIA_CHECK_FALSE_EXIT(wait_general_state(agent_manager, "Activated", 5000),
                               "HomunculusAgent not Activated within 5 s");

    boost::json::object start_params;
    start_params["Action"] = "Start";
    auto start_result = agent_manager.call_function_sync("TriggerGeneralAction", start_params, 1000);
    BROOKESIA_CHECK_FALSE_EXIT(start_result.success, "Failed to start HomunculusAgent: %s",
                               start_result.error_message.c_str());
    if (!wait_general_state(agent_manager, "Started", 5000)) {
        BROOKESIA_LOGE("HomunculusAgent not Started within 5 s");
    }

    print_heap("agent active");

    // Start the touch forwarding thread only after all hard requirements succeed.
    start_thread("touch", 6 * 1024, touch_task);
#if CONFIG_HOMUNCULUS_DEV_CONSOLE
    start_thread("console", 4 * 1024, console_task);
#endif

    // Idle forever; agent threads handle all interaction.
    while (true) {
#if CONFIG_HOMUNCULUS_SYSTEM_STATS_INTERVAL_S > 0
        std::this_thread::sleep_for(std::chrono::seconds(CONFIG_HOMUNCULUS_SYSTEM_STATS_INTERVAL_S));
        print_system_stats();
#else
        std::this_thread::sleep_for(std::chrono::seconds(60));
#endif
    }
}
