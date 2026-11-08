// Wi-Fi station with credentials from NVS (settings.hpp; Kconfig HOMUNCULUS_WIFI_SSID / _PASSWORD as default).
#pragma once

#include <string>

namespace homunculus::wifi {

// Initialises NVS, netif and the Wi-Fi driver (idempotent); no connection yet.
bool init();
bool has_credentials();
// init() and start connecting; reconnects automatically. False without credentials (Wi-Fi stays
// initialised, so provision::start() can run) or if initialisation fails.
bool start();
bool is_connected();
// Station MAC as "aa:bb:cc:dd:ee:ff".
std::string mac_string();
// RSSI of the current AP in dBm, 0 when not connected.
int rssi();

}  // namespace homunculus::wifi
