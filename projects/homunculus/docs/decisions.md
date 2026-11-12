---
id: crucible/homunculus/decisions
title: Decisions
type: AD
owner: crucible/homunculus
status: Draft
date: 2026-11-11
related: [crucible/homunculus/open-items]
---

# Decisions

Product decisions taken on resolved open items. Decided 2026-11-07.

| ID | Decision | Notes |
| --- | --- | --- |
| D-01 | **STT: local Whisper** (whisper.cpp, CPU) | Server starts on a development laptop without a GPU. Move to faster-whisper on a GPU host later; provider stays configurable ([crucible/homunculus/server/design](server/design.md) section 4.1). |
| D-02 | **TTS: local Kokoro**, provider configurable; **language: English** | Default voice a British female Kokoro voice (e.g. `bf_emma`; final pick by listening test). Piper remains the configured fallback. German is planned later. |
| D-03 | **Wake word: "Computer"** (stock WakeNet9 model `wn9_computer_tts`) | No custom model for now. A custom "Hey Claudia" (Espressif TTS-trained model or microWakeWord) remains an option if false triggers are a problem (crucible/homunculus/R-09). |
| D-04 | **Persona: "Claudia"**: female, British voice, dark British humour | Exactly one persona for now, but personas must be **data, not code**: a persona definition (name, system prompt / personality, TTS provider + voice, language, emotional range, wake word) is loaded by the server and referenced from the device profile ([crucible/homunculus/server/design](server/design.md) section 7), so more personas can be added later without code changes. The wake word is the only device-side persona attribute (model on device). |
| D-05 | **Hosting: LAN only** | Remote access (tunnel / reverse proxy) is deferred. Keep the server URL configurable, not hard-wired to mDNS, so remote access can be added later. |
| D-06 | **Flash: 32 MB** | Measured 2026-11-07 (`esptool flash_id`): ESP32-S3 (QFN56) rev v0.2, 8 MB embedded PSRAM, flash GigaDevice JEDEC `c8`/`4019`, 32 MB. Upstream board definition sets 16 MB; Homunculus overrides flash size and partition table. |
| D-07 | **ESP-Brookesia 0.8.x + ESP-IDF 6.x** | Latest released versions. Brookesia 0.8 requires IDF >= 6.0, <= 6.2 on ESP32-S3. Component versions pinned in [crucible/homunculus/firmware/design](firmware/design.md) section 1. |
| D-08 | **Latency target (interim): <= 3 s to first spoken sentence** | Replaces the [crucible/homunculus/server/design](server/design.md) section 5 budget until Phase 1 measurements. |
| D-09 | **Web lookups are announced** | Persona voice rule: one short sentence ("Let me look that up") before any web search/fetch. Measured: first sentence 3.2 s instead of 26.6 s. Orchestrator filler ([crucible/homunculus/server/design](server/design.md) section 5) remains the fallback. |
| D-10 | **Kokoro fp32, per-segment synthesis; first segment 3-8 words** | q8 measured 1.6-2.5x slower than fp32 at equal WER; kokoro-js `stream()` gives no gain. Voice rule asks for a short first sentence. Limits configurable via env ([crucible/homunculus/server/design](server/design.md) section 4.2). |
| D-11 | **Agent session recovery** | Fatal/non-retryable agent error, dead process, watchdog or stuck interrupt -> reopen session; first reopen resumes the last session id, a second consecutive failure starts fresh. |
| D-12 | **Orchestrator timeouts** | Uplink gap 2.5 s, utterance cap 22.5 s, final transcript 20 s, agent idle 90 s, speech idle 20 s, interrupt wait 8 s, whisper request 15 s ([crucible/homunculus/server/design](server/design.md) section 2). |
| D-13 | **Uplink stream id latched on First flag or seq 0** | Frames of other streams dropped. Firmware sets the First flag on seq 0. |
| D-14 | **One live conversation per device id** | A newer connection closes the older with WebSocket close code 4000 `replaced` (section 4.1). |
| D-15 | **Brookesia agent never sleeps** | Wake word from AudioEncoder `AFEEventHappened`; `afe_wake_start/end_timeout_ms` = 0 (no WakeEnd -> no automatic Sleep). |
| D-16 | **Brookesia chat mode RealTime; uplink gated by HomunculusAgent** | |
| D-17 | **Agent thread stacks in PSRAM, 8 KB each** | Internal RAM is the scarce resource (min 50 KB during turns). Measured use: worker 4.0 KB, player 2.1 KB. |
| D-18 | **Device answers `confirm.request` with `approved:false`** | Superseded by the confirmation card (Phase 3B). |
| D-19 | **Kokoro runs in a child process** | In-process inference stalled the event loop up to 219 ms (> 180 ms downlink prebuffer -> device underruns, delayed aborts); child process: max 4 ms. Worker thread rejected: onnxruntime-node aborts with sessions on main thread (Silero) and a worker. |
| D-20 | **Phase 2 = circular audio-output visualizer; procedural face deferred** | Ring waveform of the speaker signal (ES7210 DAC echo lane), colour per UI state, direct panel rendering without LVGL ([crucible/homunculus/firmware/design/avatar](firmware/design/avatar.md)). Face spec kept unchanged as `crucible/homunculus/firmware/design/avatar-face`. Decided 2026-11-08. |
| D-21 | **Firmware built with `-O2`** | `CONFIG_COMPILER_OPTIMIZATION_PERF` (as the vendor example). Idle CPU 64 / 45 % -> 57 / 36 %, internal free 67 -> 72 KB [crucible/homunculus/firmware/design](firmware/design.md) section 2.2). Brookesia service manager worker poll stays at 5 ms: 10 ms saved ~8 % of one core at `-Og` but adds up to 10 ms to every downlink audio write. Decided 2026-11-08. |
| D-22 | **Phase 3 order: 3B, then 3C; 3A (OpenCode backend) deferred** | Claude Agent SDK stays the only backend. The backend abstraction [crucible/homunculus/server/design](server/design.md) section 3) is kept. Decided 2026-11-08. |
| D-23 | **Long-term memory: temporal-reasoning MCP server (minigraf bi-temporal graph) as primary memory, plus a markdown wiki written on the user's request (Phase 3D, after 3C)** | One stdio child per memory space owned by the backend; its query / transact / retract / rule tools proxied to agent sessions; per-turn prepare (context before the utterance) and finalize (extraction via MCP sampling) as its Claude Code hooks. Wiki = entities / concepts on explicit request. Claude Code memory (CLAUDE.md, auto-memory) disabled. Spec 10. Decided 2026-11-08; revised 2026-11-08 (librarian, source log and in-process fact store removed). |
| D-24 | **Two-mic AFE deferred (crucible/homunculus/OI-02)** | Single-mic AFE stays. Decided 2026-11-10. |
| D-25 | **Launcher / multi-app deferred (crucible/homunculus/OI-10..13)** | Single-purpose assistant firmware; internal RAM is the limiting resource. Decided 2026-11-10. |
| D-26 | **Proactive reminders deferred (crucible/homunculus/OI-14)** | Decided 2026-11-10. |
| D-27 | **Single user; multi-user / speaker identification deferred (crucible/homunculus/OI-15)** | Facts are about the primary user; other people only when named. Decided 2026-11-10. |
| D-28 | **People and places tagged with `:entity-type` (crucible/homunculus/OI-17)** | `:constraint/<ident>` entities carry `:entity-type` `:type/person` / `:type/place` (attribute accepted by the temporal-reasoning schema); graph stays the only fact store; wiki pages only on request, linked to graph idents. Custom namespaces when the server schema supports them. Decided 2026-11-10. |
| D-29 | **Pairing: QR approval page, 6-digit code, admin key** | Device discovers the server via mDNS `_homunculus._tcp` (fallback: stored / Kconfig URL), requests pairing, shows the approval URL as QR code with the code underneath; approval on the phone page needs the server admin key once per phone (cookie), or `make devices ARGS="approve <code>"`. Per-device token (32 bytes), SHA-256 at rest, bound to `X-Device-Id`, revocable. Development token `dev` accepted from loopback only. Spec 03 [crucible/homunculus/firmware/design](firmware/design.md) section 5, [crucible/homunculus/server/design](server/design.md) section 9, [crucible/homunculus/security](security.md) section 3. Decided 2026-11-10. |
| D-30 | **Speaker volume default 85 %, persisted** | Brookesia AudioPlayback default (`CONFIG_BROOKESIA_SERVICE_AUDIO_PLAYBACK_VOLUME_DEFAULT`); `device.set_volume` persists across reboots. Decided 2026-11-10. |
| D-31 | **Downlink Opus 16 kHz on the 1.75C** | `hello.capabilities.audio.output.sample_rates` = `[16000]`; decoder 16 kHz. I2S playback runs at 16 kHz; a 24 kHz downlink is resampled on the device by `esp_ae_rate_cvt`, which keeps 13.6 KB of FIR tables in internal RAM after the first turn. Server resamples Kokoro (24 kHz) to 16 kHz. Decided 2026-11-10. |
