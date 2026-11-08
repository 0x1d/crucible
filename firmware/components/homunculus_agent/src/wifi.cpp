#include "homunculus/wifi.hpp"

#include <atomic>
#include <cstdio>
#include <optional>
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_wifi.h"
#include "brookesia/lib_utils/signal.hpp"
#include "brookesia/service_helper/network/wifi.hpp"
#include "brookesia/service_manager/service/manager.hpp"
#include "homunculus/settings.hpp"
#include "sdkconfig.h"

namespace homunculus::wifi {

namespace {

constexpr const char *TAG = "hom_wifi";
using Helper = esp_brookesia::service::helper::Wifi;
using esp_brookesia::service::helper::Timeout;
constexpr int ACTION_TIMEOUT_MS = 20000;

std::atomic<bool> g_connected{false};
std::atomic<bool> g_provisioning{false};
std::optional<esp_brookesia::service::ServiceBinding> g_binding;
esp_brookesia::lib_utils::scoped_connection g_event_connection;

bool action(const char *name)
{
    auto r = Helper::call_function_sync(Helper::FunctionId::TriggerGeneralAction, std::string(name),
                                        Timeout(ACTION_TIMEOUT_MS));
    if (!r) ESP_LOGE(TAG, "%s failed: %s", name, r.error().c_str());
    return static_cast<bool>(r);
}

}  // namespace

bool start()
{
    if (!settings::init()) return false;
    g_binding = esp_brookesia::service::ServiceManager::get_instance().bind(Helper::get_name().data());
    if (!g_binding->is_valid()) {
        ESP_LOGE(TAG, "Wi-Fi service bind failed");
        return false;
    }
    g_event_connection = Helper::subscribe_event(
                             Helper::EventId::GeneralEventHappened,
    [](const std::string &, const std::string &event, bool unexpected) {
        ESP_LOGI(TAG, "wifi event %s%s", event.c_str(), unexpected ? " (unexpected)" : "");
        if (event == "Connected") {
            g_connected = true;
            esp_wifi_set_ps(WIFI_PS_NONE);  // lowest latency for streaming audio
        } else if (event == "Disconnected" || event == "Stopped") {
            g_connected = false;
        }
    });
    if (!action("Init") || !action("Start")) return false;

    auto aps = Helper::call_function_sync<boost::json::array>(Helper::FunctionId::GetConnectedAps);
    bool known = aps && !aps->empty();
    if (!known && !settings::wifi_seeded() && CONFIG_HOMUNCULUS_WIFI_SSID[0] != '\0') {
        ESP_LOGI(TAG, "seeding Wi-Fi \"%s\" from Kconfig", CONFIG_HOMUNCULUS_WIFI_SSID);
        auto r = Helper::call_function_sync(Helper::FunctionId::SetConnectAp, std::string(CONFIG_HOMUNCULUS_WIFI_SSID),
                                            std::string(CONFIG_HOMUNCULUS_WIFI_PASSWORD));
        if (r && action("Connect")) {
            settings::set_wifi_seeded();
            known = true;
        }
    }
    ESP_LOGI(TAG, "%s", known ? "connecting to a saved access point" : "no saved access point");
    return known;
}

bool is_connected()
{
    return g_connected;
}

std::string ap_ssid()
{
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    char buf[24];
    std::snprintf(buf, sizeof(buf), "Homunculus-%02X%02X", mac[4], mac[5]);
    return buf;
}

std::string ap_password()
{
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    char buf[12];
    std::snprintf(buf, sizeof(buf), "%02x%02x%02x%02x", mac[2], mac[3], mac[4], mac[5]);
    return buf;
}

std::string ap_join_payload()
{
    return "WIFI:T:WPA;S:" + ap_ssid() + ";P:" + ap_password() + ";;";
}

bool start_provisioning()
{
    if (g_provisioning) return true;
    boost::json::object params{{"ssid", ap_ssid()}, {"password", ap_password()}, {"max_connection", 2}};
    auto r = Helper::call_function_sync(Helper::FunctionId::SetSoftApParams, std::move(params));
    if (!r) ESP_LOGW(TAG, "SetSoftApParams: %s", r.error().c_str());
    auto s = Helper::call_function_sync(Helper::FunctionId::TriggerSoftApProvisionStart, Timeout(ACTION_TIMEOUT_MS));
    if (!s) {
        ESP_LOGE(TAG, "provisioning start failed: %s", s.error().c_str());
        return false;
    }
    g_provisioning = true;
    ESP_LOGI(TAG, "provisioning: join \"%s\" (password %s), open http://192.168.4.1/", ap_ssid().c_str(),
             ap_password().c_str());
    return true;
}

bool stop_provisioning()
{
    if (!g_provisioning.exchange(false)) return true;
    auto r = Helper::call_function_sync(Helper::FunctionId::TriggerSoftApProvisionStop, Timeout(ACTION_TIMEOUT_MS));
    if (!r) ESP_LOGW(TAG, "provisioning stop: %s", r.error().c_str());
    return static_cast<bool>(r);
}

bool provisioning()
{
    return g_provisioning;
}

bool reset_and_provision()
{
    auto r = Helper::call_function_sync(Helper::FunctionId::ResetData);
    if (!r) ESP_LOGW(TAG, "ResetData: %s", r.error().c_str());
    settings::set_wifi_seeded();  // the Kconfig credentials must not come back
    return start_provisioning();
}

std::string mac_string()
{
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char buf[18];
    std::snprintf(buf, sizeof(buf), "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return buf;
}

int rssi()
{
    wifi_ap_record_t ap{};
    if (!g_connected || esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return 0;
    return ap.rssi;
}

}  // namespace homunculus::wifi
