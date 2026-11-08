// Firmware update over HTTP(S) (spec 03 §3.6): esp_https_ota into the passive OTA slot.
//
// Image: GET <server>/ota/<model>/firmware.bin, the server URL's scheme mapped ws -> http,
// wss -> https, with the device bearer token. The image's app description (version, project name)
// is read from the first bytes of the download: a check aborts there, an install continues only
// when the version differs from the running one. Runs on one thread with an internal-RAM stack
// (flash writes from a PSRAM-stack task assert, D-17).
//
// Rollback (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE): a freshly installed image boots pending
// verification; mark_running_valid() after the first HDP session confirms it, otherwise the
// bootloader returns to the previous image on the next reset.
#pragma once

#include <cstdint>
#include <functional>
#include <string>

namespace homunculus::ota {

enum class Phase {
    Idle,
    Checking,
    Installing,  // download + flash write running
    Restarting,  // image written and set as boot partition
};

struct Status {
    Phase phase = Phase::Idle;
    std::string running;    // running app version
    std::string available;  // image version on the server at the last check; empty: unknown
    bool update_available = false;
    int64_t checked_us = 0;  // esp_timer time of the last finished check; 0: never
    int percent = -1;        // install progress, -1 when unknown
    std::string error;       // last failure; empty after a successful check / install
};

// Install progress and outcome for the display: percent 0-100, or done with ok / error text.
struct Event {
    enum class Kind { Started, Progress, Failed, UpToDate, Restarting } kind;
    int percent = -1;
    std::string text;
};
using EventCallback = std::function<void(const Event &)>;

// Starts the OTA thread: a check on request and every CONFIG_HOMUNCULUS_OTA_CHECK_INTERVAL_H hours.
bool start(EventCallback cb);

std::string running_version();
// http(s)://<host:port>/ota/<model>/firmware.bin from the configured server URL; empty if invalid.
std::string image_url(const std::string &server_url, const char *model);

// Queue a check / an install (an install checks first). False when one is already running or
// before start(). Any thread.
bool request_check();
bool request_install();

Status status();

// Confirms a pending-verify image (no-op otherwise) on the OTA thread. Any thread.
void mark_running_valid();

}  // namespace homunculus::ota
