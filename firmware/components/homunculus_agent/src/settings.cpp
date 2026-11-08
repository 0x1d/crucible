#include "homunculus/settings.hpp"

#include <cstring>
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

namespace homunculus::settings {

namespace {

constexpr const char *TAG = "hom_settings";
constexpr const char *NS = "homunculus";

// Stored value, or `fallback` when the key is absent.
std::string get(const char *key, const char *fallback)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return fallback;
    size_t len = 0;
    std::string out = fallback;
    if (nvs_get_str(h, key, nullptr, &len) == ESP_OK) {
        std::string v(len, '\0');
        if (nvs_get_str(h, key, v.data(), &len) == ESP_OK) {
            v.resize(len > 0 ? len - 1 : 0);
            out = std::move(v);
        }
    }
    nvs_close(h);
    return out;
}

bool has(const char *key)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t len = 0;
    const bool r = nvs_get_str(h, key, nullptr, &len) == ESP_OK;
    nvs_close(h);
    return r;
}

bool put(nvs_handle_t h, const char *key, const std::string &v)
{
    if (v.empty()) {
        const esp_err_t e = nvs_erase_key(h, key);
        return e == ESP_OK || e == ESP_ERR_NVS_NOT_FOUND;
    }
    return nvs_set_str(h, key, v.c_str()) == ESP_OK;
}

// Values are read from NVS once, in init() on a task with an internal-RAM stack: flash access
// disables the cache, so tasks with PSRAM stacks (agent worker, D-17) must never touch NVS.
struct Cache {
    bool has_ssid = false;
    std::string ssid, pass, url, token;
};
Cache g_cache;

void load()
{
    g_cache.has_ssid = has("ssid");
    g_cache.ssid = get("ssid", "");
    g_cache.pass = get("pass", "");
    g_cache.url = get("url", CONFIG_HOMUNCULUS_SERVER_URL);
    g_cache.token = get("token", CONFIG_HOMUNCULUS_DEVICE_TOKEN);
}

}  // namespace

bool init()
{
    static bool done = false;
    if (done) return true;
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nvs_flash_init: %s", esp_err_to_name(err));
        return false;
    }
    load();
    done = true;
    return true;
}

Network network()
{
    if (g_cache.has_ssid) return {g_cache.ssid, g_cache.pass};
    return {CONFIG_HOMUNCULUS_WIFI_SSID, CONFIG_HOMUNCULUS_WIFI_PASSWORD};
}

std::string server_url()
{
    return g_cache.url;
}

std::string token()
{
    return g_cache.token;
}

// save() and request_provisioning() write flash: call them from tasks with internal stacks (httpd, console).
bool save(const std::string &ssid, const std::string &password, const std::string &server_url,
          const std::string &token)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    // "ssid" is stored even when empty (provisioning marker), so it is written directly.
    bool ok = nvs_set_str(h, "ssid", ssid.c_str()) == ESP_OK && put(h, "pass", password) && put(h, "url", server_url) &&
              put(h, "token", token) && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (!ok) ESP_LOGE(TAG, "save failed");
    load();
    return ok;
}

bool request_provisioning()
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    const bool ok = nvs_set_str(h, "ssid", "") == ESP_OK && put(h, "pass", "") && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    load();
    return ok;
}

}  // namespace homunculus::settings
