#include "homunculus/wifi.hpp"

#include <atomic>
#include <cstdio>
#include <cstring>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

namespace homunculus::wifi {

namespace {

constexpr const char *TAG = "hom_wifi";
constexpr int RETRY_MAX_MS = 30000;

std::atomic<bool> g_connected{false};
esp_timer_handle_t g_retry_timer = nullptr;
int g_retry_ms = 1000;

void retry_cb(void *)
{
    esp_wifi_connect();
}

void on_event(void *, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        auto *ev = static_cast<wifi_event_sta_disconnected_t *>(data);
        g_connected = false;
        ESP_LOGW(TAG, "disconnected (reason %d), retry in %d ms", ev ? ev->reason : -1, g_retry_ms);
        esp_timer_start_once(g_retry_timer, static_cast<uint64_t>(g_retry_ms) * 1000);
        g_retry_ms = g_retry_ms * 2 > RETRY_MAX_MS ? RETRY_MAX_MS : g_retry_ms * 2;
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto *ev = static_cast<ip_event_got_ip_t *>(data);
        ESP_LOGI(TAG, "connected, ip " IPSTR, IP2STR(&ev->ip_info.ip));
        g_retry_ms = 1000;
        g_connected = true;
    }
}

}  // namespace

bool start()
{
    if (std::strlen(CONFIG_HOMUNCULUS_WIFI_SSID) == 0) {
        ESP_LOGE(TAG, "no SSID configured (CONFIG_HOMUNCULUS_WIFI_SSID, see firmware/sdkconfig.local)");
        return false;
    }
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nvs_flash_init: %s", esp_err_to_name(err));
        return false;
    }
    ESP_ERROR_CHECK(esp_netif_init());
    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "event loop: %s", esp_err_to_name(err));
        return false;
    }
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    esp_timer_create_args_t timer_args{};
    timer_args.callback = retry_cb;
    timer_args.name = "wifi_retry";
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &g_retry_timer));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, nullptr, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, nullptr, nullptr));

    wifi_config_t cfg{};
    std::strncpy(reinterpret_cast<char *>(cfg.sta.ssid), CONFIG_HOMUNCULUS_WIFI_SSID, sizeof(cfg.sta.ssid));
    std::strncpy(reinterpret_cast<char *>(cfg.sta.password), CONFIG_HOMUNCULUS_WIFI_PASSWORD,
                 sizeof(cfg.sta.password));
    cfg.sta.threshold.authmode = std::strlen(CONFIG_HOMUNCULUS_WIFI_PASSWORD) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    cfg.sta.pmf_cfg.capable = true;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    // Lowest latency for streaming audio; power policy (spec 3.7) comes later.
    esp_wifi_set_ps(WIFI_PS_NONE);
    ESP_LOGI(TAG, "connecting to \"%s\"", CONFIG_HOMUNCULUS_WIFI_SSID);
    return true;
}

bool is_connected()
{
    return g_connected;
}

std::string mac_string()
{
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char buf[18];
    std::snprintf(buf, sizeof(buf), "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3], mac[4],
                  mac[5]);
    return buf;
}

int rssi()
{
    wifi_ap_record_t ap{};
    if (!g_connected || esp_wifi_sta_get_ap_info(&ap) != ESP_OK) {
        return 0;
    }
    return ap.rssi;
}

}  // namespace homunculus::wifi
