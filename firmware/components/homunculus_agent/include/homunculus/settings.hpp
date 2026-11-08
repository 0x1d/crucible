// Persistent device settings in NVS (namespace "homunculus"): Wi-Fi credentials, server URL, device token.
// A stored value wins over the Kconfig default; a stored empty SSID means "provisioning requested"
// (the Kconfig credentials are then ignored).
#pragma once

#include <string>

namespace homunculus::settings {

// Initialises NVS (idempotent).
bool init();

struct Network {
    std::string ssid;
    std::string password;
    bool configured() const
    {
        return !ssid.empty();
    }
};

Network network();
std::string server_url();
std::string token();

// Stores credentials; empty `server_url` / `token` keep the Kconfig defaults.
bool save(const std::string &ssid, const std::string &password, const std::string &server_url,
          const std::string &token);
// Drops the credentials and enters provisioning on the next boot.
bool request_provisioning();

}  // namespace homunculus::settings
