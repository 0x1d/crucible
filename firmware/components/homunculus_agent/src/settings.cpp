#include "homunculus/settings.hpp"

#include <mutex>

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
    std::string token;
    std::string server_id;
    bool seeded = false;
};
Cache g_cache;
std::mutex g_mutex;  // cache: read by the agent / OTA threads, written by the pairing thread

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
        g_cache.token = get(h, "token", "");
        g_cache.server_id = get(h, "server_id", "");
        g_cache.seeded = get(h, "seeded", "") == "1";
        nvs_close(h);
    }
    done = true;
    return true;
}

std::string server_url()
{
    std::lock_guard lock(g_mutex);
    return g_cache.url;
}

std::string token()
{
    std::lock_guard lock(g_mutex);
    return g_cache.token;
}

std::string server_id()
{
    std::lock_guard lock(g_mutex);
    return g_cache.server_id;
}

bool set_server(const std::string &url, const std::string &token, const std::string &server_id)
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    const bool ok = put(h, "url", url) && put(h, "token", token) && put(h, "server_id", server_id) &&
                    nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (ok) {
        std::lock_guard lock(g_mutex);
        g_cache.url = url.empty() ? CONFIG_HOMUNCULUS_SERVER_URL : url;
        g_cache.token = token;
        g_cache.server_id = server_id;
    }
    return ok;
}

bool set_server_url(const std::string &url)
{
    return set_server(url, token(), server_id());
}

bool clear_token()
{
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    const bool ok = put(h, "token", "") && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    if (ok) {
        std::lock_guard lock(g_mutex);
        g_cache.token.clear();
    }
    return ok;
}

std::string http_origin(const std::string &server_url)
{
    std::string scheme;
    if (server_url.rfind("wss://", 0) == 0) {
        scheme = "https://";
    } else if (server_url.rfind("ws://", 0) == 0) {
        scheme = "http://";
    } else {
        return {};
    }
    const size_t host_start = server_url.find("://") + 3;
    const size_t host_end = server_url.find('/', host_start);
    const std::string host = server_url.substr(host_start, host_end == std::string::npos ? std::string::npos
                                                                                          : host_end - host_start);
    if (host.empty()) return {};
    return scheme + host;
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
