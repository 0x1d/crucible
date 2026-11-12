// Server discovery and pairing (spec 03 §3.5), see pairing.hpp.
#include "homunculus/pairing.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <optional>
#include <thread>
#include <utility>
#include <vector>
#include "boost/json.hpp"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_pthread.h"
#include "mdns.h"
#include "sdkconfig.h"

#include "homunculus/agent.hpp"
#include "homunculus/ota.hpp"
#include "homunculus/settings.hpp"
#include "homunculus/wifi.hpp"

namespace homunculus::pairing {

namespace {

constexpr const char *TAG = "hom_pair";
constexpr size_t MAX_RESPONSE = 2048;
constexpr auto RETRY_UNREACHABLE = std::chrono::seconds(10);
constexpr auto RETRY_REJECTED = std::chrono::seconds(30);

std::mutex g_mutex;
std::condition_variable g_cv;
bool g_unauthorized = false;
bool g_unreachable = false;
bool g_started = false;
bool g_running = false;  // pairing thread alive (exits when paired and idle: 6 KB internal RAM)
EventCallback g_cb;

void emit(Event e)
{
    if (g_cb) g_cb(e);
}

// Waits up to `d`; true when woken by a request (unauthorized / unreachable).
bool wait_for(std::chrono::milliseconds d)
{
    std::unique_lock lock(g_mutex);
    return g_cv.wait_for(lock, d, [] { return g_unauthorized || g_unreachable; });
}

struct HttpResult {
    int status = 0;  // 0: transport error
    std::string body;
};

HttpResult http(esp_http_client_method_t method, const std::string &url, const std::string &body,
                const std::vector<std::pair<const char *, std::string>> &headers)
{
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.method = method;
    cfg.timeout_ms = 8000;
    if (url.rfind("https://", 0) == 0) cfg.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) return {};
    for (const auto &[k, v] : headers) esp_http_client_set_header(c, k, v.c_str());
    if (!body.empty()) esp_http_client_set_header(c, "Content-Type", "application/json");
    HttpResult r;
    if (esp_http_client_open(c, static_cast<int>(body.size())) == ESP_OK &&
        (body.empty() || esp_http_client_write(c, body.data(), static_cast<int>(body.size())) ==
         static_cast<int>(body.size())) &&
        esp_http_client_fetch_headers(c) >= 0) {
        r.status = esp_http_client_get_status_code(c);
        char buf[256];
        int n;
        while (r.body.size() < MAX_RESPONSE && (n = esp_http_client_read(c, buf, sizeof(buf))) > 0) {
            r.body.append(buf, static_cast<size_t>(n));
        }
    }
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    return r;
}

std::optional<boost::json::object> parse_object(const std::string &s)
{
    boost::system::error_code ec;
    auto v = boost::json::parse(s, ec);
    if (ec || !v.is_object()) return std::nullopt;
    return std::move(v.as_object());
}

std::string get_string(const boost::json::object &o, const char *key)
{
    const auto *v = o.if_contains(key);
    return v && v->is_string() ? std::string(v->get_string()) : std::string();
}

struct Server {
    std::string url;
    std::string id;
};

// mDNS PTR query for _homunculus._tcp; `want_id` non-empty: only that server.
std::optional<Server> discover(const std::string &want_id)
{
    if (mdns_init() != ESP_OK) {
        ESP_LOGW(TAG, "mdns_init failed");
        return std::nullopt;
    }
    mdns_result_t *results = nullptr;
    std::optional<Server> out;
    const esp_err_t err = mdns_query_ptr("_homunculus", "_tcp", CONFIG_HOMUNCULUS_MDNS_TIMEOUT_MS, 4, &results);
    for (mdns_result_t *r = results; err == ESP_OK && r && !out; r = r->next) {
        std::string path = "/hdp", id;
        bool tls = false;
        for (size_t i = 0; i < r->txt_count; i++) {
            const std::string k = r->txt[i].key ? r->txt[i].key : "";
            const std::string v = r->txt[i].value ? r->txt[i].value : "";
            if (k == "path" && !v.empty()) path = v;
            if (k == "tls") tls = v == "1";
            if (k == "id") id = v;
        }
        if (!want_id.empty() && id != want_id) continue;
        // Hosts with several interfaces (e.g. docker bridges) announce every address: prefer one in
        // the station's subnet.
        esp_netif_ip_info_t own = {};
        esp_netif_t *sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        if (sta) esp_netif_get_ip_info(sta, &own);
        esp_ip4_addr_t ip4 = {};
        bool have_ip = false, same_subnet = false;
        for (mdns_ip_addr_t *a = r->addr; a && !same_subnet; a = a->next) {
            if (a->addr.type != ESP_IPADDR_TYPE_V4) continue;
            same_subnet = own.netmask.addr != 0 &&
                          (a->addr.u_addr.ip4.addr & own.netmask.addr) == (own.ip.addr & own.netmask.addr);
            if (!have_ip || same_subnet) ip4 = a->addr.u_addr.ip4;
            have_ip = true;
        }
        if (!have_ip && r->hostname) {
            esp_ip4_addr_t a = {};
            if (mdns_query_a(r->hostname, CONFIG_HOMUNCULUS_MDNS_TIMEOUT_MS, &a) == ESP_OK) {
                ip4 = a;
                have_ip = true;
            }
        }
        if (!have_ip || r->port == 0) continue;
        char host[32];
        std::snprintf(host, sizeof(host), IPSTR ":%u", IP2STR(&ip4), static_cast<unsigned>(r->port));
        out = Server{std::string(tls ? "wss://" : "ws://") + host + path, id};
    }
    if (results) mdns_query_results_free(results);
    mdns_free();
    if (out) {
        ESP_LOGI(TAG, "mDNS: server %s at %s", out->id.c_str(), out->url.c_str());
    } else {
        ESP_LOGI(TAG, "mDNS: no _homunculus._tcp server%s (%s)", want_id.empty() ? "" : " with this id",
                 esp_err_to_name(err));
    }
    return out;
}

// One pairing request: code shown until approved, rejected or expired.
void pair_once()
{
    const auto found = discover("");
    const Server server = found.value_or(Server{settings::server_url(), ""});
    const std::string origin = settings::http_origin(server.url);
    if (origin.empty()) {
        ESP_LOGE(TAG, "invalid server URL %s", server.url.c_str());
        emit({Event::Kind::Failed, {}, {}, "invalid server URL"});
        wait_for(RETRY_UNREACHABLE);
        return;
    }

    boost::json::object req{{"device_id", wifi::mac_string()},
        {"model", HomunculusAgent::MODEL},
        {"firmware", ota::running_version()}};
    const auto r = http(HTTP_METHOD_POST, origin + "/pair", boost::json::serialize(req), {});
    const auto body = r.status == 200 ? parse_object(r.body) : std::nullopt;
    const std::string code = body ? get_string(*body, "code") : "";
    const std::string secret = body ? get_string(*body, "secret") : "";
    const std::string approve_url = body ? get_string(*body, "approve_url") : "";
    if (code.empty() || secret.empty() || approve_url.empty()) {
        ESP_LOGW(TAG, "pairing request to %s failed (http %d)", origin.c_str(), r.status);
        emit({Event::Kind::Failed, {}, {}, "server not reachable"});
        wait_for(RETRY_UNREACHABLE);
        return;
    }
    int poll_ms = 2000;
    if (const auto *v = body->if_contains("poll_ms"); v && v->is_int64()) {
        poll_ms = std::clamp(static_cast<int>(v->as_int64()), 500, 10000);
    }
    ESP_LOGI(TAG, "pairing code %s: open %s", code.c_str(), approve_url.c_str());
    emit({Event::Kind::Code, approve_url, code, {}});

    const std::string status_url = origin + "/pair/status?code=" + code;
    while (wifi::is_connected()) {
        if (wait_for(std::chrono::milliseconds(poll_ms))) return;
        const auto s = http(HTTP_METHOD_GET, status_url, "", {{"X-Pair-Secret", secret}});
        if (s.status == 404) {
            ESP_LOGI(TAG, "pairing code %s expired", code.c_str());
            return;  // next request shows a new code
        }
        const auto st = s.status == 200 ? parse_object(s.body) : std::nullopt;
        if (!st) continue;  // transient: keep polling until the code expires
        const std::string state = get_string(*st, "state");
        if (state == "approved") {
            const std::string token = get_string(*st, "token");
            const std::string name = get_string(*st, "name");
            if (token.empty() || !settings::set_server(server.url, token, server.id)) {
                ESP_LOGE(TAG, "storing the token failed");
                emit({Event::Kind::Failed, {}, {}, "storing the token failed"});
                return;
            }
            ESP_LOGI(TAG, "paired as \"%s\" with %s", name.c_str(), server.url.c_str());
            emit({Event::Kind::Paired, server.url, {}, name});
            return;
        }
        if (state == "rejected") {
            ESP_LOGW(TAG, "pairing rejected");
            emit({Event::Kind::Failed, {}, {}, "pairing rejected"});
            wait_for(RETRY_REJECTED);
            return;
        }
    }
}

// Paired server unreachable: same server id at a new address?
void relocate()
{
    const std::string id = settings::server_id();
    if (id.empty()) return;  // paired via the fallback URL: nothing to look for
    const auto found = discover(id);
    if (!found || found->url == settings::server_url()) return;
    ESP_LOGI(TAG, "server %s moved: %s -> %s", id.c_str(), settings::server_url().c_str(), found->url.c_str());
    if (settings::set_server_url(found->url)) emit({Event::Kind::ServerMoved, found->url, {}, {}});
}

void thread_main()
{
    ESP_LOGI(TAG, "pairing thread start (%s)", paired() ? "paired" : "not paired");
    while (true) {
        bool unauthorized, unreachable;
        {
            std::unique_lock lock(g_mutex);
            g_cv.wait_for(lock, std::chrono::seconds(1), [] { return g_unauthorized || g_unreachable; });
            unauthorized = std::exchange(g_unauthorized, false);
            unreachable = std::exchange(g_unreachable, false);
            // Paired and nothing to do: end; on_unauthorized() / on_unreachable() start a new thread.
            if (!unauthorized && !unreachable && paired()) {
                ESP_LOGI(TAG, "pairing thread end");
                g_running = false;
                return;
            }
        }
        if (!wifi::is_connected()) {
            std::lock_guard lock(g_mutex);
            g_unreachable |= unreachable;  // retried once Wi-Fi is back
            continue;
        }
        if (unauthorized && paired()) {
            ESP_LOGW(TAG, "token rejected by the server: pairing again");
            settings::clear_token();
        }
        if (!paired()) {
            pair_once();
        } else if (unreachable) {
            relocate();
        }
    }
}

// Caller holds g_mutex.
void spawn_locked()
{
    if (!g_started || g_running) return;
    // Called from other threads (agent worker, WebSocket task): restore their pthread config after.
    esp_pthread_cfg_t prev;
    const bool had_prev = esp_pthread_get_cfg(&prev) == ESP_OK;
    auto cfg = esp_pthread_get_default_config();
    cfg.stack_size = 6 * 1024;
    cfg.thread_name = "hom_pair";
    cfg.prio = 3;
    cfg.stack_alloc_caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;  // NVS writes (D-17)
    esp_pthread_set_cfg(&cfg);
    std::thread(thread_main).detach();
    if (had_prev) {
        esp_pthread_set_cfg(&prev);
    } else {
        auto def = esp_pthread_get_default_config();
        esp_pthread_set_cfg(&def);
    }
    g_running = true;
}

}  // namespace

bool start(EventCallback cb)
{
    std::lock_guard lock(g_mutex);
    if (g_started) return true;
    g_cb = std::move(cb);
    g_started = true;
    if (!paired()) spawn_locked();
    return true;
}

bool paired()
{
    return !settings::token().empty();
}

void on_unauthorized()
{
    std::lock_guard lock(g_mutex);
    g_unauthorized = true;
    spawn_locked();
    g_cv.notify_one();
}

void on_unreachable()
{
    std::lock_guard lock(g_mutex);
    g_unreachable = true;
    spawn_locked();
    g_cv.notify_one();
}

}  // namespace homunculus::pairing
