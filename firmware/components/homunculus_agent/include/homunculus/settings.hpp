// Persistent device settings in NVS (namespace "homunculus"): server URL, device token, and the
// one-time Wi-Fi seed flag. Wi-Fi credentials are owned by the Brookesia Wi-Fi service (wifi.hpp).
// Values are read once into RAM by init(): flash access with the cache disabled asserts on tasks
// whose stack is in PSRAM (agent worker, D-17), so only init() and the setters touch NVS.
#pragma once

#include <string>

namespace homunculus::settings {

// Initialises NVS and loads the values (idempotent). Call from a task with an internal-RAM stack.
bool init();

// Stored value, else the Kconfig default.
std::string server_url();
std::string token();
bool set_server(const std::string &url, const std::string &token);

// The Kconfig Wi-Fi credentials are offered to the Wi-Fi service once (development convenience).
bool wifi_seeded();
bool set_wifi_seeded();

}  // namespace homunculus::settings
