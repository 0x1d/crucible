#include "hdp_client.hpp"

#include <algorithm>
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_random.h"
#include "homunculus/hdp.hpp"

namespace homunculus {

namespace {
constexpr const char *TAG = "hom_ws";
constexpr uint32_t BACKOFF_MIN_MS = 1000;
constexpr uint32_t BACKOFF_MAX_MS = 60000;
constexpr int PING_INTERVAL_S = 20;
constexpr int PONG_TIMEOUT_S = 60;
constexpr size_t RX_MAX = 64 * 1024;
}  // namespace

bool HdpClient::start(const Config &config, Callbacks callbacks)
{
    if (client_) {
        return true;
    }
    callbacks_ = std::move(callbacks);
    url_ = config.url;
    headers_ = "Authorization: Bearer " + config.token + "\r\n" + "X-Device-Id: " + config.device_id + "\r\n" +
               "X-Device-Model: " + config.model + "\r\n" + "X-Firmware: " + config.firmware + "\r\n";

    esp_websocket_client_config_t cfg{};
    cfg.uri = url_.c_str();
    cfg.subprotocol = hdp::SUBPROTOCOL;
    cfg.headers = headers_.c_str();
    cfg.user_agent = "homunculus";
    cfg.task_core_id_set = true;
    cfg.task_core_id = 0;
    cfg.task_prio = 10;
    cfg.task_name = "hdp_ws";
    cfg.task_stack = 8 * 1024;
    cfg.buffer_size = 2048;
    cfg.ping_interval_sec = PING_INTERVAL_S;
    cfg.pingpong_timeout_sec = PONG_TIMEOUT_S;
    cfg.reconnect_timeout_ms = static_cast<int>(BACKOFF_MIN_MS);
    cfg.network_timeout_ms = 10000;
    cfg.enable_close_reconnect = true;
    if (url_.rfind("wss://", 0) == 0) {
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
    }

    client_ = esp_websocket_client_init(&cfg);
    if (!client_) {
        ESP_LOGE(TAG, "esp_websocket_client_init failed");
        return false;
    }
    esp_websocket_register_events(client_, WEBSOCKET_EVENT_ANY, event_handler, this);
    esp_err_t err = esp_websocket_client_start(client_);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "start: %s", esp_err_to_name(err));
        esp_websocket_client_destroy(client_);
        client_ = nullptr;
        return false;
    }
    ESP_LOGI(TAG, "connecting to %s", url_.c_str());
    return true;
}

void HdpClient::stop()
{
    std::lock_guard lock(handle_mutex_);
    if (!client_) {
        return;
    }
    if (esp_websocket_client_is_connected(client_)) {
        esp_websocket_client_close(client_, pdMS_TO_TICKS(1000));
    }
    esp_websocket_client_stop(client_);
    esp_websocket_client_destroy(client_);
    client_ = nullptr;
}

bool HdpClient::is_connected() const
{
    std::lock_guard lock(handle_mutex_);
    return client_ && esp_websocket_client_is_connected(client_);
}

bool HdpClient::send_text(const std::string &text, uint32_t timeout_ms)
{
    std::lock_guard lock(handle_mutex_);
    if (!client_ || !esp_websocket_client_is_connected(client_)) {
        return false;
    }
    int n = esp_websocket_client_send_text(client_, text.data(), static_cast<int>(text.size()),
                                           pdMS_TO_TICKS(timeout_ms));
    return n == static_cast<int>(text.size());
}

bool HdpClient::send_binary(const uint8_t *data, size_t len, uint32_t timeout_ms)
{
    std::lock_guard lock(handle_mutex_);
    if (!client_ || !esp_websocket_client_is_connected(client_)) {
        return false;
    }
    int n = esp_websocket_client_send_bin(client_, reinterpret_cast<const char *>(data), static_cast<int>(len),
                                          pdMS_TO_TICKS(timeout_ms));
    return n == static_cast<int>(len);
}

void HdpClient::reset_backoff()
{
    std::lock_guard lock(backoff_mutex_);
    backoff_ms_ = BACKOFF_MIN_MS;
}

void HdpClient::schedule_reconnect(const char *why, const esp_websocket_event_data_t *ev)
{
    uint32_t delay;
    {
        std::lock_guard lock(backoff_mutex_);
        // Full backoff value with jitter in [50 %, 100 %] (same as tools/simulator).
        delay = backoff_ms_ / 2 + esp_random() % (backoff_ms_ / 2 + 1);
        backoff_ms_ = std::min(BACKOFF_MAX_MS, backoff_ms_ * 2);
    }
    reconnects_++;
    int status = ev ? ev->error_handle.esp_ws_handshake_status_code : 0;
    int close_code = ev ? ev->close_status_code : 0;
    ESP_LOGW(TAG, "%s (http %d, close %d), reconnect in %u ms", why, status, close_code,
             static_cast<unsigned>(delay));
    esp_websocket_client_set_reconnect_timeout(client_, static_cast<int>(delay));
}

void HdpClient::event_handler(void *arg, esp_event_base_t, int32_t id, void *data)
{
    auto *self = static_cast<HdpClient *>(arg);
    auto *ev = static_cast<esp_websocket_event_data_t *>(data);
    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "connected");
        self->rx_.clear();
        if (self->callbacks_.connected) {
            self->callbacks_.connected();
        }
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
        self->schedule_reconnect("disconnected", ev);
        if (self->callbacks_.disconnected) {
            self->callbacks_.disconnected();
        }
        break;
    case WEBSOCKET_EVENT_CLOSED:
        self->schedule_reconnect("closed by server", ev);
        if (self->callbacks_.disconnected) {
            self->callbacks_.disconnected();
        }
        break;
    case WEBSOCKET_EVENT_ERROR:
        ESP_LOGW(TAG, "error (http %d)", ev ? ev->error_handle.esp_ws_handshake_status_code : 0);
        break;
    case WEBSOCKET_EVENT_DATA:
        self->on_data(ev);
        break;
    default:
        break;
    }
}

void HdpClient::on_data(const esp_websocket_event_data_t *ev)
{
    // op codes: 0 continuation, 1 text, 2 binary, 8 close, 9 ping, 10 pong.
    const uint8_t op = ev->op_code;
    if (op == 1 || op == 2) {
        if (ev->payload_offset == 0) {
            rx_.clear();
            rx_op_ = op;
        }
    } else if (op != 0) {
        return;
    }
    if (rx_op_ == 0) {
        return;
    }
    if (rx_.size() + ev->data_len > RX_MAX) {
        ESP_LOGW(TAG, "message exceeds %u bytes, dropped", static_cast<unsigned>(RX_MAX));
        rx_.clear();
        rx_op_ = 0;
        return;
    }
    rx_.insert(rx_.end(), ev->data_ptr, ev->data_ptr + ev->data_len);
    const bool frame_done = ev->payload_offset + ev->data_len >= ev->payload_len;
    if (!frame_done || !ev->fin) {
        return;
    }
    if (rx_op_ == 1) {
        if (callbacks_.text) {
            callbacks_.text(std::string(rx_.begin(), rx_.end()));
        }
    } else if (callbacks_.binary) {
        callbacks_.binary(rx_.data(), rx_.size());
    }
    rx_.clear();
    rx_op_ = 0;
}

}  // namespace homunculus
