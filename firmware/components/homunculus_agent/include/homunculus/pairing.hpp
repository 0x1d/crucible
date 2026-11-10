// Server discovery and pairing (spec 03 §3.5).
//
// Discovery: mDNS PTR query for _homunculus._tcp (TXT path, tls, id); no answer: the stored or
// Kconfig server URL. Pairing: POST <origin>/pair with device id, model, firmware; the server
// answers with a 6-digit code, a secret and the approval URL (shown as QR code); the device polls
// GET <origin>/pair/status until the request is approved (token, stored in NVS), rejected or
// expired (new request). Runs on one thread with an internal-RAM stack (NVS writes, D-17).
#pragma once

#include <functional>
#include <string>

namespace homunculus::pairing {

struct Event {
    enum class Kind {
        Code,         // show `url` as QR code with `code`
        Paired,       // paired as `text` (device name)
        Failed,       // `text`: reason (server not reachable, rejected)
        ServerMoved,  // the paired server answers at a new URL (`url`): reconnect
    } kind;
    std::string url;
    std::string code;
    std::string text;
};
using EventCallback = std::function<void(const Event &)>;

// Starts the pairing thread. Call after wifi::start().
bool start(EventCallback cb);

// A device token is stored.
bool paired();

// The server rejected the token (HTTP 401): forget it and pair again. Any thread.
void on_unauthorized();
// The paired server did not answer several connection attempts: look for it via mDNS (same server
// id) at a new address. Any thread.
void on_unreachable();

}  // namespace homunculus::pairing
