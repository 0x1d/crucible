// Firmware update over HTTP(S) (spec 03 §3.6), see ota.hpp.
#include "homunculus/ota.hpp"

#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>
#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_pthread.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "homunculus/agent.hpp"
#include "homunculus/settings.hpp"
#include "homunculus/wifi.hpp"

namespace homunculus::ota {

namespace {

constexpr const char *TAG = "hom_ota";

enum class Request { None, Check, Install };

std::mutex g_mutex;
std::condition_variable g_cv;
Request g_request = Request::None;
bool g_confirm_pending = false;  // mark_running_valid() requested
Status g_status;
EventCallback g_cb;
bool g_started = false;

void emit(Event::Kind kind, int percent = -1, std::string text = {})
{
    if (g_cb) g_cb(Event{kind, percent, std::move(text)});
}

void finish(const std::string &error)
{
    std::lock_guard lock(g_mutex);
    g_status.phase = Phase::Idle;
    g_status.percent = -1;
    g_status.error = error;
}

// Header strings outlive the HTTP client (esp_http_client_set_header copies them anyway).
esp_err_t on_client_init(esp_http_client_handle_t client)
{
    const std::string auth = "Bearer " + settings::token();
    esp_http_client_set_header(client, "Authorization", auth.c_str());
    esp_http_client_set_header(client, "X-Device-Id", wifi::mac_string().c_str());
    esp_http_client_set_header(client, "X-Device-Model", HomunculusAgent::MODEL);
    esp_http_client_set_header(client, "X-Firmware", running_version().c_str());
    return ESP_OK;
}

// One check, and an install when `install` and the image version differs from the running one.
void run(bool install)
{
    const std::string url = image_url(settings::server_url(), HomunculusAgent::MODEL);
    if (url.empty()) {
        ESP_LOGE(TAG, "no OTA URL for server %s", settings::server_url().c_str());
        finish("invalid server URL");
        return;
    }
#if !CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP
    if (url.rfind("http://", 0) == 0) {
        ESP_LOGE(TAG, "plain http OTA disabled (CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP)");
        finish("plain http not allowed");
        return;
    }
#endif
    ESP_LOGI(TAG, "%s %s", install ? "install from" : "check", url.c_str());

    esp_http_client_config_t http = {};
    http.url = url.c_str();
    http.timeout_ms = 15000;
    http.keep_alive_enable = true;
    if (url.rfind("https://", 0) == 0) http.crt_bundle_attach = esp_crt_bundle_attach;
    esp_https_ota_config_t cfg = {};
    cfg.http_config = &http;
    cfg.http_client_init_cb = on_client_init;

    esp_https_ota_handle_t h = nullptr;
    esp_err_t err = esp_https_ota_begin(&cfg, &h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "begin failed: %s", esp_err_to_name(err));
        finish(std::string("download failed: ") + esp_err_to_name(err));
        if (install) emit(Event::Kind::Failed, -1, "download failed");
        return;
    }
    esp_app_desc_t desc = {};
    err = esp_https_ota_get_img_desc(h, &desc);
    if (err != ESP_OK || std::strncmp(desc.project_name, esp_app_get_description()->project_name,
                                      sizeof(desc.project_name)) != 0) {
        ESP_LOGW(TAG, "image rejected: %s, project '%.32s'", esp_err_to_name(err), desc.project_name);
        esp_https_ota_abort(h);
        finish("not a Homunculus image");
        if (install) emit(Event::Kind::Failed, -1, "not a Homunculus image");
        return;
    }
    const std::string version(desc.version, strnlen(desc.version, sizeof(desc.version)));
    const bool newer = version != running_version();
    {
        std::lock_guard lock(g_mutex);
        g_status.available = version;
        g_status.update_available = newer;
        g_status.checked_us = esp_timer_get_time();
        g_status.error.clear();
        if (install && newer) {
            g_status.phase = Phase::Installing;
            g_status.percent = 0;
        }
    }
    ESP_LOGI(TAG, "server image %s, running %s%s", version.c_str(), running_version().c_str(),
             newer ? ": update available" : "");
    if (!install || !newer) {
        esp_https_ota_abort(h);
        finish("");
        if (install) emit(Event::Kind::UpToDate, -1, version);
        return;
    }

    emit(Event::Kind::Started, 0, version);
    const int size = esp_https_ota_get_image_size(h);
    int last_percent = 0;
    while ((err = esp_https_ota_perform(h)) == ESP_ERR_HTTPS_OTA_IN_PROGRESS) {
        if (size <= 0) continue;
        const int percent = static_cast<int>(static_cast<int64_t>(esp_https_ota_get_image_len_read(h)) * 100 / size);
        if (percent >= last_percent + 5) {
            last_percent = percent;
            {
                std::lock_guard lock(g_mutex);
                g_status.percent = percent;
            }
            ESP_LOGI(TAG, "%d %%", percent);
            emit(Event::Kind::Progress, percent);
        }
    }
    if (err == ESP_OK && !esp_https_ota_is_complete_data_received(h)) err = ESP_ERR_INVALID_SIZE;
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "download failed: %s", esp_err_to_name(err));
        esp_https_ota_abort(h);
        finish(std::string("download failed: ") + esp_err_to_name(err));
        emit(Event::Kind::Failed, -1, "download failed");
        return;
    }
    // Validates the image and sets the boot partition.
    err = esp_https_ota_finish(h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "image invalid: %s", esp_err_to_name(err));
        finish(std::string("image invalid: ") + esp_err_to_name(err));
        emit(Event::Kind::Failed, -1, "image invalid");
        return;
    }
    {
        std::lock_guard lock(g_mutex);
        g_status.phase = Phase::Restarting;
        g_status.percent = 100;
    }
    ESP_LOGW(TAG, "installed %s, restarting", version.c_str());
    emit(Event::Kind::Restarting, 100, version);
    std::this_thread::sleep_for(std::chrono::seconds(2));
    esp_restart();
}

// Pending-verify image -> valid. Writes otadata: OTA thread only (internal-RAM stack).
void confirm_running()
{
    esp_ota_img_states_t state;
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
        const esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
        ESP_LOGI(TAG, "image %s confirmed: %s", running_version().c_str(), esp_err_to_name(err));
    }
}

void thread_main()
{
    const auto interval = std::chrono::hours(CONFIG_HOMUNCULUS_OTA_CHECK_INTERVAL_H);
    while (true) {
        Request r;
        bool confirm;
        {
            std::unique_lock lock(g_mutex);
            const bool woken =
                g_cv.wait_for(lock, interval, [] { return g_request != Request::None || g_confirm_pending; });
            r = woken ? g_request : Request::Check;
            confirm = g_confirm_pending;
            g_request = Request::None;
            g_confirm_pending = false;
            if (r != Request::None) {
                g_status.phase = Phase::Checking;
                g_status.percent = -1;
            }
        }
        if (confirm) confirm_running();
        if (r != Request::None) run(r == Request::Install);
    }
}

bool request(Request r)
{
    std::lock_guard lock(g_mutex);
    if (!g_started || g_status.phase != Phase::Idle || g_request == Request::Install) return false;
    g_request = r;
    g_cv.notify_one();
    return true;
}

}  // namespace

bool start(EventCallback cb)
{
    std::lock_guard lock(g_mutex);
    if (g_started) return true;
    g_cb = std::move(cb);
    g_status.running = running_version();
    auto cfg = esp_pthread_get_default_config();
    cfg.stack_size = 6 * 1024;
    cfg.thread_name = "hom_ota";
    cfg.prio = 3;
    cfg.stack_alloc_caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;  // flash writes (D-17)
    esp_pthread_set_cfg(&cfg);
    std::thread(thread_main).detach();
    g_started = true;
    return true;
}

std::string running_version()
{
    const auto *d = esp_app_get_description();
    return std::string(d->version, strnlen(d->version, sizeof(d->version)));
}

std::string image_url(const std::string &server_url, const char *model)
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
    return scheme + host + "/ota/" + model + "/firmware.bin";
}

bool request_check()
{
    return request(Request::Check);
}

bool request_install()
{
    return request(Request::Install);
}

Status status()
{
    std::lock_guard lock(g_mutex);
    return g_status;
}

void mark_running_valid()
{
    std::lock_guard lock(g_mutex);
    g_confirm_pending = true;
    g_cv.notify_one();
}

}  // namespace homunculus::ota
