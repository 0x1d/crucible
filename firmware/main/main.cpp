// Homunculus: boots the HDP/1 agent on ESP-Brookesia, connects to Wi-Fi, and hands
// wake-word / touch / audio over to the agent_manager-driven HomunculusAgent. The display
// shows the Phase 2 circular audio-output visualizer (spec 06), coloured by agent state.

#include <algorithm>
#include <atomic>
#include <map>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>
#include <string>
#include <ctime>
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_system.h"
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
#include "brookesia/service_helper/network/sntp.hpp"
#include "homunculus/agent.hpp"
#include "homunculus/ota.hpp"
#include "homunculus/settings.hpp"
#include "homunculus/visualizer.hpp"
#include "homunculus/wifi.hpp"
#include "sdkconfig.h"

using namespace esp_brookesia;

namespace {

// Acquired interfaces must stay alive: releasing the last handle deinitialises the device.
hal::InterfaceHandle<hal::display::PanelIface> g_panel;
hal::InterfaceHandle<hal::display::BacklightIface> g_backlight;
hal::InterfaceHandle<hal::power::BatteryIface> g_battery;  // AXP2101 on the 1.75C; null without a PMU
std::mutex g_draw_mutex;
bool g_visualizer = false;

// Solid state colours (RGB) when the visualizer is disabled or fails to start.
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
#if CONFIG_HOMUNCULUS_VISUALIZER
    g_visualizer = homunculus::Visualizer::get_instance().start(g_panel.get().get());
    if (!g_visualizer) {
        BROOKESIA_LOGE("[display] visualizer failed to start; solid state colours");
    }
#endif

    g_battery = hal::acquire_first_interface<hal::power::BatteryIface>();
    if (!g_battery) BROOKESIA_LOGW("[power] no battery interface");

    g_backlight = hal::acquire_first_interface<hal::display::BacklightIface>();
    if (g_backlight) {
        g_backlight->set_brightness(80);
    }
}

void show_ui_state(homunculus::UiState s)
{
    if (g_visualizer) {
        homunculus::Visualizer::get_instance().set_state(s);
        return;
    }
    switch (s) {
    case homunculus::UiState::Offline: paint_solid(OFFLINE); break;
    case homunculus::UiState::Idle: paint_solid(IDLE); break;
    case homunculus::UiState::Listening: paint_solid(LISTENING); break;
    case homunculus::UiState::Thinking: paint_solid(THINKING); break;
    case homunculus::UiState::Speaking: paint_solid(SPEAKING); break;
    }
}

// ---------------------------------------------------------------------------
// Cards and device tools (spec 03 §3.4, spec 06 §6.6)

enum class CardOwner { None, Text, Confirm };
std::mutex g_card_mutex;
CardOwner g_card_owner = CardOwner::None;
esp_timer_handle_t g_text_timer = nullptr;

// A confirmation replaces a text card; a text card never replaces a confirmation.
void on_confirm(bool show, const std::string &title, const std::string &detail)
{
    if (!g_visualizer) return;
    std::lock_guard lock(g_card_mutex);
    auto &vis = homunculus::Visualizer::get_instance();
    if (show) {
        if (g_text_timer) esp_timer_stop(g_text_timer);
        g_card_owner = CardOwner::Confirm;
        vis.show_confirm_card(title, detail);
    } else if (g_card_owner == CardOwner::Confirm) {
        g_card_owner = CardOwner::None;
        vis.hide_card();
    }
}

void hide_text_card(void *)
{
    std::lock_guard lock(g_card_mutex);
    if (g_card_owner != CardOwner::Text) return;
    g_card_owner = CardOwner::None;
    homunculus::Visualizer::get_instance().hide_card();
}

using homunculus::HomunculusAgent;
using Reply = HomunculusAgent::ToolReply;

// Integer argument in [lo, hi]; nullopt when missing or out of range.
std::optional<int> int_arg(const boost::json::object &a, const char *key, int lo, int hi)
{
    const auto *v = a.if_contains(key);
    if (!v || !v->is_number()) return std::nullopt;
    const double d = v->to_number<double>();
    if (d < lo || d > hi) return std::nullopt;
    return static_cast<int>(d);
}

// "Sunday 8 November 2026, 14:05, CET (UTC+01:00)"; nullopt before the first SNTP sync.
std::optional<std::string> local_time_text()
{
    using SNTP = service::helper::SNTP;
    const auto synced = SNTP::call_function_sync<bool>(SNTP::FunctionId::IsTimeSynced);
    const time_t now = time(nullptr);
    if ((!synced || !*synced) && now < 1700000000) return std::nullopt;  // RTC still at the epoch
    struct tm tm = {};
    localtime_r(&now, &tm);
    char weekday[16], month_year[32], clock[8], zone[8], abbr[16];
    std::strftime(weekday, sizeof(weekday), "%A", &tm);
    std::strftime(month_year, sizeof(month_year), "%B %Y", &tm);
    std::strftime(clock, sizeof(clock), "%H:%M", &tm);
    std::strftime(zone, sizeof(zone), "%z", &tm);  // +0100
    std::strftime(abbr, sizeof(abbr), "%Z", &tm);
    const std::string z(zone);
    const std::string utc = z.size() == 5 ? "UTC" + z.substr(0, 3) + ":" + z.substr(3) : z;
    return std::string(weekday) + " " + std::to_string(tm.tm_mday) + " " + month_year + ", " + clock + ", " + abbr +
           " (" + utc + ")";
}

// "battery 67 %, 3920 mV, charging" / "no battery, external power"; from the PMU (AXP2101).
std::string battery_text()
{
    using Battery = hal::power::BatteryIface;
    Battery::State st;
    if (!g_battery || !g_battery->get_state(st)) return "battery n/a";
    std::string text;
    if (!st.is_present) {
        text = "no battery";
    } else {
        text = "battery " + (st.percentage ? std::to_string(*st.percentage) + " %" : std::string("level unknown"));
        if (st.voltage_mv) text += ", " + std::to_string(*st.voltage_mv) + " mV";
        if (st.is_critical) text += ", critical";
        else if (st.is_low) text += ", low";
    }
    switch (st.charge_state) {
    case Battery::ChargeState::Full: text += ", full"; break;
    case Battery::ChargeState::Fault: text += ", charger fault"; break;
    case Battery::ChargeState::NotCharging:
    case Battery::ChargeState::Unknown: break;
    default: text += ", charging"; break;
    }
    if (st.power_source == Battery::PowerSource::External) text += ", external power";
    else if (st.power_source == Battery::PowerSource::Battery) text += ", on battery";
    return text;
}

void register_device_tools(HomunculusAgent &agent)
{
    namespace json = boost::json;
    esp_timer_create_args_t timer_args = {};
    timer_args.callback = hide_text_card;
    timer_args.name = "text_card";
    esp_timer_create(&timer_args, &g_text_timer);

    auto level_schema = [](int lo, int hi) {
        return json::object{{"type", "object"},
                            {"properties", {{"level", {{"type", "integer"}, {"minimum", lo}, {"maximum", hi}}}}},
                            {"required", {"level"}}};
    };

    agent.add_tool("device.set_volume", "Set the speaker volume (0-100 percent)", level_schema(0, 100),
    [](const json::object &a) -> Reply {
        const auto level = int_arg(a, "level", 0, 100);
        if (!level) return {false, "level must be an integer from 0 to 100"};
        using Playback = service::helper::AudioPlayback;
        auto r = Playback::call_function_sync(Playback::FunctionId::SetVolume, static_cast<double>(*level));
        if (!r) return {false, "volume change failed: " + r.error()};
        return {true, "volume set to " + std::to_string(*level) + " percent"};
    });

    agent.add_tool("device.set_brightness", "Set the screen brightness (1-100 percent)", level_schema(1, 100),
    [](const json::object &a) -> Reply {
        const auto level = int_arg(a, "level", 1, 100);
        if (!level) return {false, "level must be an integer from 1 to 100"};
        if (!g_backlight) return {false, "no backlight"};
        g_backlight->set_brightness(*level);
        return {true, "brightness set to " + std::to_string(*level) + " percent"};
    });

    agent.add_tool("device.show_text",
                   "Show a short text card on the screen for a while, e.g. a phone number or an address",
                   json::object{{"type", "object"},
                                {"properties",
                                 {{"text", {{"type", "string"}, {"maxLength", 160}}},
                                  {"duration_s", {{"type", "integer"}, {"minimum", 1}, {"maximum", 120}, {"default", 15}}}}},
                                {"required", {"text"}}},
    [](const json::object &a) -> Reply {
        const auto *t = a.if_contains("text");
        if (!t || !t->is_string() || t->get_string().empty()) return {false, "text must be a non-empty string"};
        const int seconds = a.contains("duration_s") ? int_arg(a, "duration_s", 1, 120).value_or(0) : 15;
        if (seconds == 0) return {false, "duration_s must be an integer from 1 to 120"};
        if (!g_visualizer) return {false, "no display"};
        std::lock_guard lock(g_card_mutex);
        if (g_card_owner == CardOwner::Confirm) return {false, "a confirmation is showing"};
        g_card_owner = CardOwner::Text;
        homunculus::Visualizer::get_instance().show_text_card(std::string(t->get_string()));
        esp_timer_stop(g_text_timer);
        esp_timer_start_once(g_text_timer, static_cast<uint64_t>(seconds) * 1000000);
        return {true, "text shown for " + std::to_string(seconds) + " seconds"};
    });

    agent.add_tool("device.show_qr", "Show a QR code on the screen for a while, e.g. a link or contact",
                   json::object{{"type", "object"},
                                {"properties",
                                 {{"data", {{"type", "string"}, {"maxLength", 150}}},
                                  {"caption", {{"type", "string"}, {"maxLength", 60}}},
                                  {"duration_s", {{"type", "integer"}, {"minimum", 1}, {"maximum", 300}, {"default", 30}}}}},
                                {"required", {"data"}}},
    [](const json::object &a) -> Reply {
        const auto *d = a.if_contains("data");
        if (!d || !d->is_string() || d->get_string().empty()) return {false, "data must be a non-empty string"};
        const auto *c = a.if_contains("caption");
        const std::string caption = c && c->is_string() ? std::string(c->get_string()) : "";
        const int seconds = a.contains("duration_s") ? int_arg(a, "duration_s", 1, 300).value_or(0) : 30;
        if (seconds == 0) return {false, "duration_s must be an integer from 1 to 300"};
        if (!g_visualizer) return {false, "no display"};
        std::lock_guard lock(g_card_mutex);
        if (g_card_owner == CardOwner::Confirm) return {false, "a confirmation is showing"};
        if (!homunculus::Visualizer::get_instance().show_qr_card("", std::string(d->get_string()), caption)) {
            return {false, "data does not fit in a QR code"};
        }
        g_card_owner = CardOwner::Text;
        esp_timer_stop(g_text_timer);
        esp_timer_start_once(g_text_timer, static_cast<uint64_t>(seconds) * 1000000);
        return {true, "QR code shown for " + std::to_string(seconds) + " seconds"};
    });

    agent.add_tool("device.get_status",
                   "Get device status: battery, uptime, free memory, Wi-Fi signal strength, firmware version",
                   json::object{{"type", "object"}, {"properties", json::object{}}},
    [](const json::object &) -> Reply {
        wifi_ap_record_t ap = {};
        const bool wifi = esp_wifi_sta_get_ap_info(&ap) == ESP_OK;
        char buf[160];
        // Caps passed to heap_caps_get_free_size() are ANDed: query each memory type separately.
        std::snprintf(buf, sizeof(buf),
                      "uptime %lld s, free memory: internal %u KB, PSRAM %u KB, Wi-Fi signal %s%d dBm",
                      static_cast<long long>(esp_timer_get_time() / 1000000),
                      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024),
                      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024),
                      wifi ? "" : "n/a ", wifi ? ap.rssi : 0);
        std::string text = battery_text() + ", " + buf;
        const auto ota = homunculus::ota::status();
        text += ", firmware " + ota.running;
        if (ota.update_available) text += ", update " + ota.available + " available";
        return {true, text};
    });

    agent.add_tool("device.get_time", "Get the current local date, time and time zone of the device",
                   json::object{{"type", "object"}, {"properties", json::object{}}},
    [](const json::object &) -> Reply {
        const auto now = local_time_text();
        if (!now) return {false, "the clock is not set yet (no network time)"};
        return {true, *now};
    });

    agent.add_tool("device.set_timezone",
                   "Set the device time zone as a POSIX TZ string, e.g. CET-1CEST,M3.5.0,M10.5.0/3 for Zurich or "
                   "GMT0BST,M3.5.0/1,M10.5.0 for London. Persists across restarts",
                   json::object{{"type", "object"},
                                {"properties", {{"posix_tz", {{"type", "string"}, {"minLength", 3}, {"maxLength", 64}}}}},
                                {"required", {"posix_tz"}}},
    [](const json::object &a) -> Reply {
        const auto *t = a.if_contains("posix_tz");
        if (!t || !t->is_string()) return {false, "posix_tz must be a string"};
        const std::string tz(t->get_string());
        // POSIX TZ: name, offset, optional DST rule; printable ASCII without spaces.
        const bool valid = tz.size() >= 3 && tz.size() <= 64 &&
                           std::all_of(tz.begin(), tz.end(), [](char c) { return c > ' ' && c < 0x7f; });
        if (!valid) return {false, "posix_tz must be a POSIX TZ string such as CET-1CEST,M3.5.0,M10.5.0/3"};
        using SNTP = service::helper::SNTP;
        auto r = SNTP::call_function_sync(SNTP::FunctionId::SetTimezone, tz);
        if (!r) return {false, "time zone change failed: " + r.error()};
        const auto now = local_time_text();
        return {true, "time zone set to " + tz + (now ? ", local time now " + *now : "")};
    });

    // Not in the server allow list: every call is confirmed on the device (spec 05 §5.6).
    agent.add_tool("device.update_firmware",
                   "Install the newest firmware from the Homunculus server; the device restarts when done",
                   json::object{{"type", "object"}, {"properties", json::object{}}},
    [](const json::object &) -> Reply {
        const auto st = homunculus::ota::status();
        if (st.phase == homunculus::ota::Phase::Installing || st.phase == homunculus::ota::Phase::Restarting) {
            return {true, "an update is already being installed"};
        }
        if (!homunculus::ota::request_install()) return {false, "an update check is running, try again shortly"};
        if (st.checked_us > 0 && !st.update_available) {
            return {true, "checking again; the last check found no update (running " + st.running + ")"};
        }
        return {true, "update started (running " + st.running +
                      (st.update_available ? ", server has " + st.available : "") +
                      "); the device shows progress and restarts in about a minute when done"};
    });

    // Development: a tool the server policy does not know asks for confirmation (default-deny).
    agent.add_tool("device.reboot", "Restart the device", json::object{{"type", "object"}, {"properties", json::object{}}},
    [](const json::object &) -> Reply {
        std::thread([] {
            std::this_thread::sleep_for(std::chrono::milliseconds(1500));
            esp_restart();
        }).detach();
        return {true, "restarting"};
    });
}

// ---------------------------------------------------------------------------
// Firmware update (spec 03 §3.6): progress and outcome as a text card

// `seconds` 0: stays until replaced (progress, restart).
void show_ota_card(const std::string &text, int seconds)
{
    if (!g_visualizer) return;
    std::lock_guard lock(g_card_mutex);
    if (g_card_owner == CardOwner::Confirm) return;
    g_card_owner = CardOwner::Text;
    homunculus::Visualizer::get_instance().show_text_card(text);
    esp_timer_stop(g_text_timer);
    if (seconds > 0) esp_timer_start_once(g_text_timer, static_cast<uint64_t>(seconds) * 1000000);
}

void on_ota_event(const homunculus::ota::Event &e)
{
    using Kind = homunculus::ota::Event::Kind;
    switch (e.kind) {
    case Kind::Started: show_ota_card("Updating firmware to " + e.text, 0); break;
    case Kind::Progress: show_ota_card("Updating firmware " + std::to_string(e.percent) + " %", 0); break;
    case Kind::Restarting: show_ota_card("Firmware " + e.text + " installed, restarting", 0); break;
    case Kind::UpToDate: show_ota_card("Firmware is up to date (" + e.text + ")", 10); break;
    case Kind::Failed: show_ota_card("Firmware update failed: " + e.text, 15); break;
    }
}

// ---------------------------------------------------------------------------
// Wi-Fi provisioning (spec 03 §3.5): Brookesia Wi-Fi service SoftAP + web page; QR code joins the AP

constexpr int PROVISION_FALLBACK_S = 90;  // saved access points that never connect open the setup AP

void show_provisioning_card()
{
    if (!g_visualizer) return;
    const std::string caption = homunculus::wifi::ap_ssid() + " password " + homunculus::wifi::ap_password() +
                                ", then open 192.168.4.1";
    std::lock_guard lock(g_card_mutex);
    if (g_card_owner == CardOwner::Confirm) return;
    if (homunculus::Visualizer::get_instance().show_qr_card("Scan to set up Wi-Fi", homunculus::wifi::ap_join_payload(),
                                                           caption)) {
        g_card_owner = CardOwner::Text;
    }
}

void hide_provisioning_card()
{
    std::lock_guard lock(g_card_mutex);
    if (g_visualizer && g_card_owner == CardOwner::Text) {
        g_card_owner = CardOwner::None;
        homunculus::Visualizer::get_instance().hide_card();
    }
}

// Runs for the whole uptime: opens the setup AP when no connection comes up for PROVISION_FALLBACK_S,
// and closes it (and its card) as soon as the station is connected, however provisioning was started.
void provision_watch_task()
{
    int offline_s = 0;
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        if (homunculus::wifi::is_connected()) {
            offline_s = 0;
            if (homunculus::wifi::provisioning()) {
                BROOKESIA_LOGI("[prov] Wi-Fi connected: closing setup AP");
                homunculus::wifi::stop_provisioning();
                hide_provisioning_card();
            }
        } else if (!homunculus::wifi::provisioning() && ++offline_s == PROVISION_FALLBACK_S) {
            BROOKESIA_LOGW("[prov] no Wi-Fi for %1% s: starting setup AP", PROVISION_FALLBACK_S);
            if (homunculus::wifi::start_provisioning()) show_provisioning_card();
        }
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
                const auto &p = points.front();
                homunculus::HomunculusAgent::get_instance().touch_at(p.x, p.y, info.x_max + 1, info.y_max + 1);
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
    // Also fills `stacks` with "name:min_free_bytes" for the Homunculus threads and `top` with
    // the busiest tasks since the previous call ("name/core:percent", percent of one core).
    void sample(int load_out[2], std::string &stacks, std::string &top)
    {
        const UBaseType_t n = uxTaskGetNumberOfTasks() + 4;
        std::vector<TaskStatus_t> tasks(n);
        configRUN_TIME_COUNTER_TYPE total = 0;
        const UBaseType_t got = uxTaskGetSystemState(tasks.data(), n, &total);
        const int64_t now = esp_timer_get_time();
        configRUN_TIME_COUNTER_TYPE idle[2] = {0, 0};
        const int64_t dt_us = now - last_us_;
        std::vector<std::pair<int, std::string>> busy;
        std::map<TaskHandle_t, configRUN_TIME_COUNTER_TYPE> run;
        for (UBaseType_t i = 0; i < got; i++) {
            const std::string name = tasks[i].pcTaskName;
            run[tasks[i].xHandle] = tasks[i].ulRunTimeCounter;
            auto it = last_run_.find(tasks[i].xHandle);
            if (last_us_ > 0 && dt_us > 0 && it != last_run_.end()) {
                const int pct = static_cast<int>(static_cast<int64_t>(tasks[i].ulRunTimeCounter - it->second) * 100 / dt_us);
                const int core = tasks[i].xCoreID > 1 ? -1 : static_cast<int>(tasks[i].xCoreID);
                if (pct > 0 && name.rfind("IDLE", 0) != 0) {
                    busy.emplace_back(pct, name + "/" + (core < 0 ? "*" : std::to_string(core)) + ":" + std::to_string(pct));
                }
            }
            if (name == "hom_worker" || name == "hom_player" || name == "hdp_ws" || name == "touch" ||
                    name == "console" || name == "hom_vis") {
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
        last_run_ = std::move(run);
        std::sort(busy.begin(), busy.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
        for (size_t i = 0; i < busy.size() && i < 8; i++) top += " " + busy[i].second;
    }

private:
    std::map<TaskHandle_t, configRUN_TIME_COUNTER_TYPE> last_run_;
    int64_t last_us_ = 0;
    configRUN_TIME_COUNTER_TYPE last_idle_[2] = {0, 0};
};

std::mutex g_stats_mutex;
CpuLoad g_cpu_load;

void print_system_stats()
{
    std::lock_guard lock(g_stats_mutex);
    int load[2];
    std::string stacks, top;
    g_cpu_load.sample(load, stacks, top);
    BROOKESIA_LOGI(
        "[stats] ui %1%, cpu core0 %2% %%, core1 %3% %%, internal free %4% KB (min %5% KB), PSRAM free %6% KB, "
        "stack min free%7%",
        homunculus::to_string(homunculus::HomunculusAgent::get_instance().ui_state()), load[0], load[1],
        heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024,
        heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL) / 1024, heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024,
        stacks
    );
    BROOKESIA_LOGI("[stats] top tasks (%% of one core):%1%", top);
    if (g_visualizer) {
        BROOKESIA_LOGI("[stats] visualizer %1%", homunculus::Visualizer::get_instance().take_stats());
    }
}

#if CONFIG_HOMUNCULUS_DEV_CONSOLE
// Development console: single-key commands on the USB-Serial-JTAG console.
void console_task()
{
    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    if (usb_serial_jtag_driver_install(&cfg) == ESP_OK) {
        usb_serial_jtag_vfs_use_driver();
    }
    BROOKESIA_LOGI("[console] keys: t = touch, w = wake word, s = stats, r = HDP reconnect, d = Wi-Fi disconnect, v = visualizer test tone, p = Wi-Fi provisioning, u = firmware update");
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
#if CONFIG_HOMUNCULUS_VISUALIZER
        case 'v':
            BROOKESIA_LOGI("[console] visualizer test tone 5 s");
            homunculus::Visualizer::get_instance().inject_test_tone(5000);
            break;
#endif
        case 'p':
            BROOKESIA_LOGW("[console] forgetting Wi-Fi, starting provisioning");
            if (homunculus::wifi::reset_and_provision()) show_provisioning_card();
            break;
        case 'u':
            BROOKESIA_LOGI("[console] firmware update: %1%", homunculus::ota::request_install() ? "started" : "busy");
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
    BROOKESIA_LOGI("=== Homunculus (Phase 3: device tools, OTA) ===");
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
    agent.set_confirm_callback(on_confirm);
    // First HDP session after an update confirms the image (rollback otherwise); then look for updates.
    agent.set_session_callback([] {
        homunculus::ota::mark_running_valid();
#if CONFIG_HOMUNCULUS_OTA_CHECK_ON_CONNECT
        homunculus::ota::request_check();
#endif
    });
    register_device_tools(agent);
    homunculus::ota::start(on_ota_event);
    BROOKESIA_LOGI("[ota] running %1%", homunculus::ota::running_version());

    // Start Wi-Fi; the agent's worker thread opens the HDP connection once connected.
    if (!homunculus::wifi::start()) {
        BROOKESIA_LOGW("[wifi] no saved access point: provisioning");
        if (homunculus::wifi::start_provisioning()) show_provisioning_card();
    }
    start_thread("prov_watch", 6 * 1024, provision_watch_task);

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
