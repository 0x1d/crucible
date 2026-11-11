---
id: crucible/homunculus/open-items
title: Open Items
type: OI
owner: crucible/homunculus
status: Draft
date: 2026-11-11
related: [crucible/homunculus/decisions]
---

# Open Items

| ID | Question | Owner / next step |
| --- | --- | --- |
| OI-01 | Actual flash size on shipping 1.75C units (schematic: 16 MB part; vendor: 32 MB) | **Decided** -> crucible/homunculus/D-06 |
| OI-02 | Two-mic AFE (beamforming/DOA) feasibility and CPU cost on S3 | **Deferred** -> crucible/homunculus/D-24 |
| OI-03 | Brookesia version: stay on v0.7 or go directly to v0.8 | **Decided** -> crucible/homunculus/D-07 |
| OI-04 | Can `brookesia_agent_xiaozhi` target a custom server without XiaoZhi OTA/activation? (would enable a protocol-compatible early spike) | **Answered**: yes, via `CONFIG_XIAOZHI_OTA_URL` + a server-side OTA stub (research notes) |
| OI-05 | STT/TTS default providers (local vs cloud) and target languages | **Decided** -> crucible/homunculus/D-01, crucible/homunculus/D-02 |
| OI-06 | Custom wake word "Homunculus" (WakeNet custom model via Espressif) vs stock wake word | **Decided** -> crucible/homunculus/D-03 |
| OI-07 | Persona definition: name, voice, personality, default emotional range | **Decided** -> crucible/homunculus/D-04 (default emotional range deferred with the procedural face, crucible/homunculus/D-20) |
| OI-08 | Server hosting: LAN-only vs remote access (tunnel / reverse proxy) | **Decided** -> crucible/homunculus/D-05 |
| OI-09 | Memory: rely on backend session memory, or add long-term memory MCP server | **Decided** -> crucible/homunculus/D-23 |
| OI-10..13 | Launcher / multi-app on Brookesia `system_super` (round display, avatar integration, audio arbitration, heap) | **Deferred** -> crucible/homunculus/D-25 [crucible/homunculus/firmware/design/apps-and-launcher](firmware/design/apps-and-launcher.md) section 5) |
| OI-14..17 | Memory: proactive reminders, speaker identification, minigraf addon in nix (resolved), personal-fact namespace | crucible/homunculus/OI-14 deferred (crucible/homunculus/D-26), crucible/homunculus/OI-15 deferred (crucible/homunculus/D-27), crucible/homunculus/OI-17 decided (crucible/homunculus/D-28); [crucible/homunculus/server/design/memory](server/design/memory.md) section 9 |
| OI-18 | Documents of the required sets are not written yet. Firmware: requirements, architecture, security, operations, verification. Server: requirements, architecture, interfaces, security, operations, verification. HDP: verification (conformance checks) | Write them from the project documents and the code |
