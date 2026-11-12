// Persistent device settings in NVS (namespace "homunculus"): server URL, device token and server id
// from pairing (spec 03 §3.5), and the one-time Wi-Fi seed flag. Wi-Fi credentials are owned by the Brookesia Wi-Fi service (wifi.hpp).
// Values are read once into RAM by init(): flash access with the cache disabled asserts on tasks
// whose stack is in PSRAM (agent worker, D-17), so only init() and the setters touch NVS.
#pragma once

#include <string>

namespace homunculus::settings {

// Initialises NVS and loads the values (idempotent). Call from a task with an internal-RAM stack.
bool init();

// Stored server URL, else CONFIG_HOMUNCULUS_SERVER_URL.
std::string server_url();
// Device token from pairing; empty: not paired.
std::string token();
// Server id (mDNS TXT `id`) of the paired server; empty when unknown.
std::string server_id();
bool set_server(const std::string &url, const std::string &token, const std::string &server_id);
// Keeps the token, changes the URL (server found at a new address).
bool set_server_url(const std::string &url);
// Forgets the token (revoked or rejected): the device pairs again.
bool clear_token();

// "ws://host:port/path" -> "http://host:port", "wss://..." -> "https://..."; empty if invalid.
std::string http_origin(const std::string &server_url);

// The Kconfig Wi-Fi credentials are offered to the Wi-Fi service once (development convenience).
bool wifi_seeded();
bool set_wifi_seeded();

}  // namespace homunculus::settings
