// Provisioning web form helpers (spec 03 §3.5): platform independent, host-tested.
#pragma once

#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace homunculus::provision {

// application/x-www-form-urlencoded body -> fields ('+' = space, %XX decoded).
std::map<std::string, std::string> parse_form(std::string_view body);

std::string html_escape(std::string_view s);

struct Fields {
    std::string ssid, password, server_url, token;
};

// Empty string when valid, else the reason. SSID 1-32 bytes, password empty (open) or 8-63,
// server URL empty or ws:// / wss:// with a host, token <= 128 printable ASCII characters.
std::string validate(const Fields &f);

// The setup page: `networks` become suggestions for the SSID field.
std::string page(const std::vector<std::string> &networks, const std::string &default_server_url, const std::string &error);

}  // namespace homunculus::provision
