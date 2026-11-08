#include "homunculus/settings.hpp"

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

namespace homunculus::settings {

namespace {

constexpr const char *TAG = "hom_settings";
constexpr const char *NS = "homunculus";

struct Cache {
    std::string url = CONFIG_HOMUNCULUS_SERVER_URL;
    std::string token = CONFIG_HOMUNCULUS_DEVICE_TOKEN;
    bool seeded = false;
};
Cache g_cache;

std::string get(nvs_handle_t h, const char *key, const std::string &fallback)
{
    size_t len = 0;
    if (nvs_get_str(h, key, nullptr, &len) != ESP_OK || len == 0) return fallback;
    std::string v(len, '\0');
    if (nvs_get_str(h, key, v.data(), &len) != ESP_OK) return fallback;
    v.resize(len - 1);
    return v;
}

bool put(nvs_handle_t h, const char *key, const std::string &v)
{
    if (v.empty()) {
        const esp_err_t e = nvs_erase_key(h, key);
        return e == ESP_OK || e == ESP_ERR_NVS_NOT_FOUND;
    }
    return nvs_set_str(h, key, v.c_str()) == ESP_OK;
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
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) == ESP_OK) {
        g_cache.url = get(h, "url", CONFIG_HOMUNCULUS_SERVER_URL);
        g_cache.token = get(h, "token", CONFIG_HOMUNCULUS_DEVICE_TOKEN);
        g_cache.seeded = get(h, "seeded", "") == "1";
        nvs_close(h);
    }
    done = true;
    return true;
}

std::string server_url()
{
    return g_cache.url;
}

std::string token()
{
    return g_cache.token;
}

bool set_server(const std::string &url, const std::string &token)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    const bool ok = put(h, "url", url) && put(h, "token", token) && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (ok) {
        g_cache.url = url.empty() ? CONFIG_HOMUNCULUS_SERVER_URL : url;
        g_cache.token = token.empty() ? CONFIG_HOMUNCULUS_DEVICE_TOKEN : token;
    }
    return ok;
}

bool wifi_seeded()
{
    return g_cache.seeded;
}

bool set_wifi_seeded()
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    const bool ok = nvs_set_str(h, "seeded", "1") == ESP_OK && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (ok) g_cache.seeded = true;
    return ok;
}

}  // namespace homunculus::settings
