#include "homunculus/provision_form.hpp"

#include <cctype>

namespace homunculus::provision {

namespace {

int hex(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string decode(std::string_view s)
{
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '+') {
            out += ' ';
        } else if (s[i] == '%' && i + 2 < s.size() + 0 && hex(s[i + 1]) >= 0 && hex(s[i + 2]) >= 0) {
            out += static_cast<char>(hex(s[i + 1]) * 16 + hex(s[i + 2]));
            i += 2;
        } else {
            out += s[i];
        }
    }
    return out;
}

}  // namespace

std::map<std::string, std::string> parse_form(std::string_view body)
{
    std::map<std::string, std::string> out;
    size_t i = 0;
    while (i <= body.size()) {
        size_t amp = body.find('&', i);
        if (amp == std::string_view::npos) amp = body.size();
        const std::string_view pair = body.substr(i, amp - i);
        const size_t eq = pair.find('=');
        if (!pair.empty()) {
            out[decode(pair.substr(0, eq))] = eq == std::string_view::npos ? "" : decode(pair.substr(eq + 1));
        }
        i = amp + 1;
    }
    return out;
}

std::string html_escape(std::string_view s)
{
    std::string out;
    for (const char c : s) {
        switch (c) {
        case '&': out += "&amp;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '"': out += "&quot;"; break;
        case '\'': out += "&#39;"; break;
        default: out += c;
        }
    }
    return out;
}

std::string validate(const Fields &f)
{
    if (f.ssid.empty() || f.ssid.size() > 32) return "SSID must be 1-32 characters";
    if (!f.password.empty() && (f.password.size() < 8 || f.password.size() > 63)) {
        return "Wi-Fi password must be 8-63 characters (or empty for an open network)";
    }
    if (!f.server_url.empty()) {
        const bool ws = f.server_url.rfind("ws://", 0) == 0, wss = f.server_url.rfind("wss://", 0) == 0;
        if ((!ws && !wss) || f.server_url.size() <= (ws ? 5u : 6u) || f.server_url.size() > 200) {
            return "Server URL must look like ws://host:8443/hdp or wss://host/hdp";
        }
    }
    if (f.token.size() > 128) return "Token is too long";
    for (const char c : f.token) {
        if (!std::isprint(static_cast<unsigned char>(c)) || c == ' ') return "Token must be printable ASCII without spaces";
    }
    return "";
}

std::string page(const std::vector<std::string> &networks, const std::string &default_server_url, const std::string &error)
{
    std::string h =
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Homunculus setup</title><style>body{font-family:sans-serif;max-width:26em;margin:1em auto;padding:0 1em}"
        "label{display:block;margin-top:1em}input{width:100%;box-sizing:border-box;padding:.5em;font-size:1em}"
        "button{margin-top:1.5em;padding:.7em 1.5em;font-size:1em}.err{color:#b00020}</style></head><body>"
        "<h1>Homunculus setup</h1>";
    if (!error.empty()) h += "<p class=err>" + html_escape(error) + "</p>";
    h += "<form method=post action=/save><label>Wi-Fi network<input name=ssid list=nets maxlength=32 required></label><datalist id=nets>";
    for (const auto &n : networks) h += "<option value=\"" + html_escape(n) + "\">";
    h += "</datalist><label>Wi-Fi password<input name=password type=password maxlength=63></label>"
         "<label>Server URL<input name=server maxlength=200 value=\"" + html_escape(default_server_url) + "\"></label>"
         "<label>Device token (optional)<input name=token maxlength=128></label>"
         "<button type=submit>Save and restart</button></form></body></html>";
    return h;
}

}  // namespace homunculus::provision
