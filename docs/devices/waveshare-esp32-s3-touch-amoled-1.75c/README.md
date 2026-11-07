# Waveshare ESP32-S3-Touch-AMOLED-1.75C

| | |
| --- | --- |
| **Device ID (Homunculus)** | `ws-s3-amoled-175c` |
| **Vendor SKU** | 33691 (battery included), 33692 (no battery) |
| **Form factor** | Round "badge/pocket-watch" board in CNC-machined aluminium enclosure, battery bay |
| **Role in Homunculus** | Reference device (tier 1) — first supported target |
| **Status** | Documentation collected 2026-11-07 |

![Board](images/esp32-s3-touch-amoled-1.75c.jpg)

## 1. Summary

The ESP32-S3-Touch-AMOLED-1.75C combines an ESP32-S3R8 SoC with a 1.75" 466 × 466 round AMOLED touch display, a full audio front end (dual MEMS microphones → ES7210 ADC with hardware echo-reference loopback, ES8311 codec → NS4150B class-D amplifier → onboard speaker), a QMI8658 6-axis IMU and an AXP2101 PMIC with Li-ion charging. It contains every peripheral Homunculus needs for a voice-driven, animated companion (mic array + AEC reference, speaker, high-quality display, touch, motion, battery) without additional hardware.

## 2. Key specifications

| Category | Specification |
| --- | --- |
| SoC | ESP32-S3R8 — Xtensa LX7 dual-core @ up to 240 MHz, vector (PIE) extensions for DSP/NN |
| On-chip memory | 512 KB SRAM, 384 KB ROM, 16 KB RTC SRAM |
| PSRAM | 8 MB Octal PSRAM, stacked in package (OPI, 80 MHz) |
| Flash | 32 MB external NOR flash, QIO 80 MHz (measured: GigaDevice, JEDEC `c8`/`4019`; schematic U2 is labelled XM25QH128DHIQT = 16 MB — see caveats) |
| Wireless | 2.4 GHz Wi-Fi 802.11 b/g/n, Bluetooth 5 LE; onboard PCB antenna |
| Display | 1.75" AMOLED, 466 × 466 px, 16.7 M colours (RGB565 used by BSP), round active area |
| Display driver | CO5300, QSPI interface (SPI2_HOST), tearing-effect (TE) line on GPIO13 |
| Touch | CST9217 (Hynitron) capacitive controller, I²C @ 0x5A, interrupt + reset |
| Audio ADC | ES7210 4-ch ADC (I²C 0x40); MIC1, MIC2 analog MEMS mics + MIC3 = speaker loopback (AEC reference) |
| Audio codec | ES8311 mono codec (I²C 0x18), DAC → NS4150B 3 W class-D amp, enable on GPIO46 |
| Speaker | Onboard speaker (solder pads "SPK +/−"); 1511-type 8 Ω 1 W cavity speaker per schematic note |
| IMU | QMI8658 6-axis (3-axis accel + 3-axis gyro), I²C @ 0x6B, INT1 → GPIO21 |
| Power management | AXP2101 PMIC (I²C 0x34): DCDC1 → 3V3 system rail, ALDO1 → analog 3V3 (A3V3), charger, fuel gauge, backup (RTC) battery charge |
| Battery | 3.7 V Li-Po via MX1.25 2-pin connector ("BAT +/−"); charge + discharge |
| USB | USB-C, native ESP32-S3 USB (GPIO19/20) — USB-Serial/JTAG for flashing, logging and debugging |
| Buttons | PWR (AXP2101 PWRON, state readable on GPIO3) and BOOT (GPIO0) — both programmable |
| Expansion | Test pads: GPIO17, 18, 39, 40, 41, 42, UART0 TX/RX, I²C SDA/SCL, 3V3, VBUS, GND |
| RTC | AXP2101 RTC LDO + VBACKUP keeps ESP32-S3 RTC domain alive; **no discrete RTC IC** on schematic |
| Dimensions | See [images/ESP32-S3-Touch-AMOLED-1.75C-details-size.webp](images/ESP32-S3-Touch-AMOLED-1.75C-details-size.webp) |

## 3. Document map

| Document | Content |
| --- | --- |
| [hardware.md](hardware.md) | Subsystem-level hardware description, block diagram, buses, power tree, audio path |
| [pinout.md](pinout.md) | Complete GPIO allocation, I²C address map, test pads, strapping notes |
| [software.md](software.md) | ESP-IDF toolchain, BSP, ESP-Brookesia support, vendor examples, flashing, sdkconfig baseline |
| [sources.md](sources.md) | Origin and retrieval date of every artifact in this folder |
| [schematics/](schematics/) | Vendor schematic PDF + rendered PNGs and the GPIO allocation table |
| [datasheets/](datasheets/) | ESP32-S3, CO5300, ES7210, ES8311, QMI8658, AXP2101 |
| [reference/](reference/) | Snapshot of the vendor BSP (v3.0.0, Apache-2.0), Brookesia board YAMLs, vendor Brookesia example config |

## 4. Suitability assessment for Homunculus

| Requirement | Coverage | Notes |
| --- | --- | --- |
| Voice input | ✅ | 2 mics + hardware loopback → ESP-SR AFE (AEC, NS, VAD, WakeNet) feasible on-device |
| Voice output | ✅ | ES8311 + NS4150B; small speaker — intelligibility good, bass limited |
| Barge-in (interrupt while speaking) | ✅ | Hardware AEC reference (MIC3 ← DAC output) makes this practical |
| Animated avatar | ✅ | 466² AMOLED; full-frame RGB565 = 434 KB → must live in PSRAM; QSPI bandwidth limits to ~25–30 fps full-screen, more with partial updates |
| Touch interaction | ✅ | Single-touch CST9217 (tap, swipe, long-press) |
| Motion / gestures | ✅ | QMI8658 — pick-up-to-wake, shake, orientation, tap |
| Battery operation | ✅ | AXP2101 charger + gauge; AMOLED black pixels are free — dark avatar UI saves power |
| Connectivity | ⚠️ | 2.4 GHz only; Wi-Fi + audio streaming needs PSRAM-backed LWIP buffers |
| On-device LLM | ❌ | Not feasible — inference is server-side by design |

## 5. Known caveats

- **Flash size mismatch**: product page and vendor examples: 32 MB (`CONFIG_ESPTOOLPY_FLASHSIZE_32MB`). Schematic: XM25QH128DHIQT (128 Mbit = 16 MB). Upstream ESP-Brookesia board definition: 16 MB. Measured 2026-11-07 on one unit: GigaDevice `c8`/`4019`, 32 MB. Check each unit with `esptool.py flash_id`.
- **Mic layout in Brookesia**: the Brookesia board config records only one microphone plus reference (`MIC_LAYOUT="RMNN"`, 2 channels). Using both microphones for beam-forming requires a 3-channel layout ("MMR"-style) and AFE re-tuning — to be evaluated.
- **Display + touch reset**: LCD reset is GPIO1, touch reset GPIO2; the BSP comment states the touch reset is "shared with LCD reset" in one code path — keep reset sequencing as done in the BSP.
- **Touch mirroring**: touch coordinates must be mirrored on both axes (`mirror_x = mirror_y = 1`).
- **Display gap**: CO5300 column offset of 6 px (`esp_lcd_panel_set_gap(panel, 0x06, 0)`; CASET 0x0006–0x01D7).
- **LVGL stack**: Brookesia screen creation needs > 8 KB; vendor example uses a 40 KB LVGL task stack in PSRAM.
- **No SD card, no camera** on this board.
