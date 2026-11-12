---
id: crucible/homunculus/firmware/hardware
title: Hardware
type: HW
owner: crucible/homunculus/firmware
status: Draft
date: 2026-11-11
depends: []
related: [crucible/homunculus/firmware/design]
planned: []
---

# Hardware

| Device ID | Board | SoC | Display | Audio | Status | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `ws-s3-amoled-175c` | Waveshare ESP32-S3-Touch-AMOLED-1.75C | ESP32-S3R8, 8 MB PSRAM | 1.75" AMOLED 466x466 round, touch | 2 mics + AEC ref, speaker | Reference device | [waveshare-esp32-s3-touch-amoled-1.75c](hardware/waveshare-esp32-s3-touch-amoled-1-75c.md) |

## Adding a device

Each device gets its own folder `docs/firmware/hardware/<vendor>-<board>.md` (one sub-document) and an asset folder of the same name with:

| File / folder | Content |
| --- | --- |
| `README.md` | Summary, key specifications, suitability assessment for Homunculus, caveats |
| `hardware.md` | Block diagram, subsystems (power, display, touch, audio, sensors, wireless) |
| `pinout.md` | GPIO allocation, I2C address map, bus parameters, test pads, buttons |
| `software.md` | Toolchain, BSP, ESP-Brookesia board support, vendor examples, sdkconfig baseline, partitions |
| `sources.md` | Origin and retrieval date of every artifact |
| `schematics/` | Vendor schematics (+ rendered PNGs) |
| `datasheets/` | Datasheets of all major ICs |
| `images/` | Product photos, dimension drawings |
| `reference/` | Snapshots of vendor BSP / board configs (licence permitting) |

Minimum hardware requirements for a Homunculus device: ESP32-S3 (or newer, e.g. ESP32-P4 + C6) with >= 8 MB PSRAM, I2S microphone path (ideally with hardware AEC reference), speaker output, a display >= 240x240, Wi-Fi.
