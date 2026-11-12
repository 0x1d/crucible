---
id: crucible/homunculus/firmware
title: Firmware
type: manifest
owner: crucible/homunculus
profile: device
status: active
summary: "ESP-IDF firmware for the Homunculus device: audio, wake word, avatar, device tools, HDP client"
code: firmware
depends: [crucible/homunculus/hdp]
implements: [crucible/homunculus/hdp/interfaces/device-protocol]
documents: [crucible/homunculus/firmware/design, crucible/homunculus/firmware/hardware]
date: 2026-11-11
---

# Firmware

The firmware of the Homunculus device. It runs on ESP32-S3 boards with ESP-IDF and ESP-Brookesia, captures and plays audio, shows the avatar and talks to the server over HDP.

| Document | Title |
| --- | --- |
| [crucible/homunculus/firmware/design](design.md) | Design, with sub-documents for the avatar, the planned face and the launcher |
| [crucible/homunculus/firmware/hardware](hardware.md) | Supported boards |

Not written yet (crucible/homunculus/OI-18): requirements, architecture, security, operations, verification. Until then the project documents cover them: [crucible/homunculus/requirements](../requirements.md), [crucible/homunculus/architecture](../architecture.md), [crucible/homunculus/security](../security.md).

## Dependencies

| Component | Uses | Interface |
| --- | --- | --- |
| crucible/homunculus/hdp | Connection to the server; the firmware implements the device side | [crucible/homunculus/hdp/interfaces/device-protocol](../hdp/interfaces/device-protocol.md) |
