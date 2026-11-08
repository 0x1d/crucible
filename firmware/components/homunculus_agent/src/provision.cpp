#include "homunculus/provision.hpp"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <vector>
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "homunculus/provision_form.hpp"
#include "homunculus/settings.hpp"
#include "sdkconfig.h"

namespace homunculus::provision {

namespace {

constexpr const char *TAG = "hom_prov";
constexpr size_t MAX_BODY = 1024;

httpd_handle_t g_server = nullptr;
esp_netif_t *g_ap_netif = nullptr;
std::vector<std::string> g_networks;
std::atomic<bool> g_running{false};

void restart_cb(void *)
{
    esp_restart();
}

void scan_networks()
{
    g_networks.clear();
    wifi_scan_config_t cfg{};
    if (esp_wifi_scan_start(&cfg, true) != ESP_OK) return;
    uint16_t n = 0;
    esp_wifi_scan_get_ap_num(&n);
    n = std::min<uint16_t>(n, 20);
    std::vector<wifi_ap_record_t> recs(n);
    if (esp_wifi_scan_get_ap_records(&n, recs.data()) != ESP_OK) return;
    std::sort(recs.begin(), recs.begin() + n, [](const auto &a, const auto &b) { return a.rssi > b.rssi; });
    for (uint16_t i = 0; i < n; i++) {
        std::string s(reinterpret_cast<const char *>(recs[i].ssid));
        if (!s.empty() && std::find(g_networks.begin(), g_networks.end(), s) == g_networks.end()) g_networks.push_back(s);
    }
    ESP_LOGI(TAG, "scan: %u networks", static_cast<unsigned>(g_networks.size()));
}

esp_err_t send_page(httpd_req_t *req, const std::string &error)
{
    const std::string html = page(g_networks, settings::server_url(), error);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, html.c_str(), static_cast<ssize_t>(html.size()));
}

esp_err_t get_root(httpd_req_t *req)
{
    return send_page(req, "");
}

esp_err_t post_save(httpd_req_t *req)
{
    if (req->content_len == 0 || req->content_len > MAX_BODY) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad request size");
        return ESP_OK;
    }
    std::string body(req->content_len, '\0');
    size_t got = 0;
    while (got < body.size()) {
        const int r = httpd_req_recv(req, body.data() + got, body.size() - got);
        if (r <= 0) return ESP_FAIL;
        got += static_cast<size_t>(r);
    }
    auto form = parse_form(body);
    const Fields f{form["ssid"], form["password"], form["server"], form["token"]};
    if (const std::string err = validate(f); !err.empty()) {
        ESP_LOGW(TAG, "rejected: %s", err.c_str());
        return send_page(req, err);
    }
    if (!settings::save(f.ssid, f.password, f.server_url, f.token)) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "could not store settings");
        return ESP_OK;
    }
    ESP_LOGI(TAG, "saved network \"%s\", restarting", f.ssid.c_str());
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_sendstr(req, "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                            "<h1>Saved</h1><p>Homunculus is restarting and joining the network.</p>");
    esp_timer_create_args_t args{};
    args.callback = restart_cb;
    args.name = "prov_restart";
    esp_timer_handle_t t;
    if (esp_timer_create(&args, &t) == ESP_OK) esp_timer_start_once(t, 1500 * 1000);
    return ESP_OK;
}

// Any other URL (captive portal probes, typos) shows the form.
esp_err_t not_found(httpd_req_t *req, httpd_err_code_t)
{
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
    return httpd_resp_send(req, nullptr, 0);
}

}  // namespace

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

bool running()
{
    return g_running;
}

bool start()
{
    if (g_running) return true;
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();  // idempotent; the scan needs a started driver
    scan_networks();
    if (!g_ap_netif) g_ap_netif = esp_netif_create_default_wifi_ap();

    wifi_config_t ap{};
    const std::string ssid = ap_ssid(), pass = ap_password();
    std::memcpy(ap.ap.ssid, ssid.data(), ssid.size());
    ap.ap.ssid_len = static_cast<uint8_t>(ssid.size());
    std::memcpy(ap.ap.password, pass.data(), pass.size());
    ap.ap.max_connection = 2;
    ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
    if (esp_wifi_set_mode(WIFI_MODE_APSTA) != ESP_OK || esp_wifi_set_config(WIFI_IF_AP, &ap) != ESP_OK) {
        ESP_LOGE(TAG, "SoftAP start failed");
        return false;
    }

    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.stack_size = 6 * 1024;
    cfg.lru_purge_enable = true;
    if (httpd_start(&g_server, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "httpd start failed");
        return false;
    }
    httpd_uri_t root{.uri = "/", .method = HTTP_GET, .handler = get_root, .user_ctx = nullptr};
    httpd_uri_t save{.uri = "/save", .method = HTTP_POST, .handler = post_save, .user_ctx = nullptr};
    httpd_register_uri_handler(g_server, &root);
    httpd_register_uri_handler(g_server, &save);
    httpd_register_err_handler(g_server, HTTPD_404_NOT_FOUND, not_found);
    g_running = true;
    ESP_LOGI(TAG, "provisioning: join \"%s\" (password %s), open http://192.168.4.1/", ssid.c_str(), pass.c_str());
    return true;
}

void stop()
{
    if (!g_running) return;
    if (g_server) httpd_stop(g_server);
    g_server = nullptr;
    esp_wifi_set_mode(WIFI_MODE_STA);
    g_running = false;
}

}  // namespace homunculus::provision
