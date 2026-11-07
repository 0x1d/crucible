// Wi-Fi station with credentials from Kconfig (HOMUNCULUS_WIFI_SSID / _PASSWORD).
#pragma once

#include <string>

namespace homunculus::wifi {

// Initialises NVS, netif and Wi-Fi and starts connecting; reconnects automatically.
// Returns false if no SSID is configured or initialisation fails.
bool start();
bool is_connected();
// Station MAC as "aa:bb:cc:dd:ee:ff".
std::string mac_string();
// RSSI of the current AP in dBm, 0 when not connected.
int rssi();

}  // namespace homunculus::wifi
