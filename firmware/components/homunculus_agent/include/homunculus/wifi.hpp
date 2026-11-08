// Wi-Fi via the Brookesia Wi-Fi service (scan, saved access points, auto-connect, SoftAP provisioning
// page). The service persists access points through the Brookesia Storage service.
#pragma once

#include <string>

namespace homunculus::wifi {

// Initialises NVS settings, binds the Wi-Fi service, subscribes to connection events and starts the
// station, which auto-connects to a saved access point. The Kconfig credentials are offered once when
// none is saved. Returns true when an access point is known; false: call start_provisioning().
// Call from a task with an internal-RAM stack (app_main).
bool start();
bool is_connected();

// SoftAP "Homunculus-XXXX" (last two MAC bytes), WPA2, password = last four MAC bytes in hex; the
// service serves its provisioning page (network scan, password) at http://192.168.4.1/.
std::string ap_ssid();
std::string ap_password();
// "WIFI:T:WPA;S:<ssid>;P:<password>;;": phones join the access point from this QR code.
std::string ap_join_payload();
bool start_provisioning();
bool stop_provisioning();
bool provisioning();
// Forgets the saved access points and starts provisioning.
bool reset_and_provision();

// Station MAC as "aa:bb:cc:dd:ee:ff".
std::string mac_string();
// RSSI of the current AP in dBm, 0 when not connected.
int rssi();

}  // namespace homunculus::wifi
