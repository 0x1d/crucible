// Wi-Fi provisioning over a SoftAP and a web form (spec 03 §3.5).
#pragma once

#include <string>

namespace homunculus::provision {

// SoftAP name "Homunculus-XXXX" (last two MAC bytes) and its WPA2 password (last four MAC bytes, hex).
std::string ap_ssid();
std::string ap_password();

// Starts the access point (station stays enabled) and the setup page at http://192.168.4.1/.
// Saving valid settings stores them and restarts the device. Needs wifi::init(). Idempotent.
bool start();
void stop();
bool running();

}  // namespace homunculus::provision
