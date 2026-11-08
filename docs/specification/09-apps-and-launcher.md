# 9. Apps and Launcher (ESP-Brookesia System)

## 9.1 Current state

| Item | State |
| --- | --- |
| Brookesia components in use | `hal_boards`, `hal_adaptor`, `hal_interface`, `service_audio`, `service_storage`, `service_manager`, `service_helper`, `agent_manager`, `lib_utils` |
| Brookesia system / app components in use | none (`system_core`, `system_super`, `app_*` not in `dependencies.lock`) |
| Boot | `main.cpp` → Wi-Fi → `HomunculusAgent` + direct panel drawing (`g_panel`, `homunculus_avatar`); no GUI framework, no LVGL |
| Launcher | none |

## 9.2 Brookesia system stack (v0.8)

| Layer | Component | Facts |
| --- | --- | --- |
| System | `espressif/brookesia_system_core` | App lifecycle (install/start/stop), runtime app package scanning, GUI document ownership, services `SystemCore`/`SystemGui`/`SystemTimer`, permission tiers |
| System | `espressif/brookesia_system_super` | Standard system for rectangular touch screens: Shell (home dashboard, app launcher, notifications), overlay (status bar, gesture indicators), light/dark theme, app-switch transitions |
| App | `espressif/brookesia_app_settings` | Device/system configuration |
| App | `espressif/brookesia_app_files` | File browser |
| App | `espressif/brookesia_app_store` | Local/remote app package install/update |
| App kinds | Native | Subclass `IApp` (C++); static metadata via `get_manifest()` (id, name, version, launch metadata) |
| App kinds | Runtime | Unpacked app packages, scripted convention functions, scanned by System Core |
| App sandbox | Regular app | Operates only on its own GUI document; no access to layers/mount targets. Shell/overlay access is limited to system-derived and built-in components |

Source: <https://docs.espressif.com/projects/esp-brookesia/en/latest/system/index.html>

## 9.3 Fit with the reference device

| Concern | Fact |
| --- | --- |
| Display | 1.75C is round, 466×466 AMOLED. `system_super` is documented for rectangular touch screens; round-display support is **unverified** (OI-10) |
| Avatar | Avatar is drawn directly on the panel (06-avatar.md); System Core apps own an LVGL-style GUI document. Avatar must become an app or a system-level layer (OI-11) |
| Agent | `HomunculusAgent` is an `agent_manager` agent and independent of the GUI system; can run alongside the system (wake word, audio, HDP) |
| Memory | LVGL + system + launcher add PSRAM/internal-heap load; internal heap min is 50 KB with the current firmware (§8.6 p1d) |
| Vendor example | `03_esp-brookesia` (vendored `brookesia_core` 0.6.0-beta2, phone-style UI, Coze agent) is the only round-display launcher reference on this device |

## 9.4 Planned app model

| Item | Plan |
| --- | --- |
| Launcher | Brookesia `system_super` Shell, if OI-10 resolves positively; otherwise `system_core` + custom round launcher |
| App 1: Assistant | Existing `HomunculusAgent` + avatar. Default foreground app; wake word and server-initiated events return to it |
| Further apps | Candidates (unscheduled): Settings (`brookesia_app_settings`: Wi-Fi, volume, brightness), Clock/Timers, Camera/Gallery (OV5647 absent on 1.75C; skip), IMU/Level, Server-driven apps |
| Always-on services | Audio service, wake word, HDP connection stay resident regardless of foreground app |
| Audio arbitration | Single speaker/mic: foreground app other than Assistant must release or share `AudioPlayback`; wake word `WakeStart` brings Assistant to foreground (OI-12) |
| Distribution | Native apps compiled into the firmware image; runtime packages via `app_store`/LittleFS only if needed |

## 9.5 Open items

| ID | Question | Next step |
| --- | --- | --- |
| OI-10 | Does `system_super` (Shell/launcher/overlay) render correctly on a 466×466 round panel, or does it need a custom shell on `system_core`? | Spike: add `system_super` + `app_settings` to a scratch build, run on the 1.75C |
| OI-11 | Avatar integration: render as an `IApp` GUI document vs. a system-level layer vs. direct panel access (current) | Depends on OI-10 |
| OI-12 | Audio and wake-word arbitration between Assistant and other apps | Define after OI-10 |
| OI-13 | Heap budget with LVGL + system_super + agent (internal RAM min 50 KB today) | Measure in OI-10 spike |
