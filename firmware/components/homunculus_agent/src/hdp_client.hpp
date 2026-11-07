// HDP/1 WebSocket transport (spec 4.1): sub-protocol hdp.v1, auth/device headers,
// ping every 20 s, reconnect with exponential backoff 1 s -> 60 s + jitter.
// send_*() and stop() may be called from different threads; stop() waits for
// in-flight sends. stop() must not be called from a callback (WebSocket task).
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <vector>
#include "esp_websocket_client.h"

namespace homunculus {

class HdpClient {
public:
    struct Config {
        std::string url;
        std::string token;
        std::string device_id;
        std::string model;
        std::string firmware;
    };
    struct Callbacks {
        std::function<void()> connected;            // upgrade done; send hello
        std::function<void()> disconnected;         // transport lost (reconnect scheduled)
        std::function<void(std::string &&)> text;   // complete text message
        std::function<void(const uint8_t *, size_t)> binary;  // complete binary message
    };

    bool start(const Config &config, Callbacks callbacks);
    void stop();
    bool is_connected() const;
    bool send_text(const std::string &text, uint32_t timeout_ms = 200);
    bool send_binary(const uint8_t *data, size_t len, uint32_t timeout_ms = 100);
    // Call once the session is established (server hello): next reconnect waits 1 s again.
    void reset_backoff();
    uint32_t reconnects() const
    {
        return reconnects_;
    }

private:
    static void event_handler(void *arg, esp_event_base_t base, int32_t id, void *data);
    void on_data(const esp_websocket_event_data_t *ev);
    void schedule_reconnect(const char *why, const esp_websocket_event_data_t *ev);

    mutable std::mutex handle_mutex_;  // guards client_ against stop() during send
    esp_websocket_client_handle_t client_ = nullptr;
    Callbacks callbacks_;
    std::string headers_;
    std::string url_;
    std::vector<uint8_t> rx_;
    uint8_t rx_op_ = 0;
    std::mutex backoff_mutex_;
    uint32_t backoff_ms_ = 1000;
    std::atomic<uint32_t> reconnects_{0};
};

}  // namespace homunculus
