# Software Support — ESP32-S3-Touch-AMOLED-1.75C

## 1. Toolchain

| Item | Value |
| --- | --- |
| Framework | ESP-IDF (Arduino-ESP32 3.3.x also supported by vendor, not used by Homunculus) |
| Vendor-tested IDF versions | v5.5.5, v6.0.2 |
| Target | `esp32s3` |
| Installer | Espressif Installation Manager (EIM) or `install.sh` from an IDF checkout; VS Code ESP-IDF extension ≥ 2.0 auto-detects |
| Flash / monitor | `idf.py -p /dev/ttyACM0 flash monitor` (native USB-Serial/JTAG enumerates as `ttyACM*`) |

Forced download mode: power off completely, hold **BOOT**, power on, flash, then power-cycle (the device does not leave download mode automatically).

## 2. Board Support Package

| | |
| --- | --- |
| Component | [`waveshare/esp32_s3_touch_amoled_1_75c`](https://components.espressif.com/components/waveshare/esp32_s3_touch_amoled_1_75c) v3.0.0 (Apache-2.0) |
| Requires | IDF ≥ 5.5, `espressif/esp_codec_dev ~1.5`, `espressif/esp_lcd_co5300`, `espressif/esp_lcd_panel_io_additions ^1`, `espressif/esp_lvgl_adapter ~0.6`, `waveshare/esp_lcd_touch_cst9217`, `lvgl/lvgl >=8,<10`, `espressif/usb ^1` (IDF ≥ 6.0) |
| Capabilities | `BSP_CAPS_DISPLAY`, `TOUCH`, `AUDIO`, `AUDIO_SPEAKER`, `AUDIO_MIC` = 1; `BUTTONS`, `SDCARD`, `IMU` = 0 |
| Snapshot | [reference/bsp-esp32_s3_touch_amoled_1_75c-3.0.0/](reference/bsp-esp32_s3_touch_amoled_1_75c-3.0.0/) |

Key API surface:

```c
esp_err_t              bsp_i2c_init(void);
lv_display_t          *bsp_display_start_with_config(const bsp_display_cfg_t *cfg);
esp_err_t              bsp_display_lock(int timeout_ms) / bsp_display_unlock(void);
esp_err_t              bsp_display_brightness_set(int percent);   // DCS 0x51
esp_err_t              bsp_audio_init(const i2s_std_config_t *cfg); // full-duplex I2S
esp_codec_dev_handle_t bsp_audio_codec_speaker_init(void);           // ES8311 + PA
esp_codec_dev_handle_t bsp_audio_codec_microphone_init(void);        // ES7210
```

The IMU (QMI8658) and PMIC (AXP2101) are **not** covered by the BSP; use `XPowersLib` (vendor example 01) or Brookesia's AXP2101 power implementation, and a QMI8658 driver component (e.g. `waveshare/qmi8658`) or the code in vendor example 04.

## 3. Vendor examples (ESP-IDF)

Repository: <https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C> (`examples/esp-idf`)

| Example | Content | Relevance for Homunculus |
| --- | --- | --- |
| 01_AXP2101 | XPowersLib port; prints battery/VBUS/charger telemetry | PMIC driver reference |
| 02_lvgl_demo_v9 | LVGL 9 demo on BSP | Display/LVGL baseline |
| 03_esp-brookesia | Brookesia **0.6.0-beta2** phone UI (vendored `brookesia_core`), SquareLine demo app; AI framework, anim player, speaker system **disabled** in sdkconfig | Starting point requested by project; see §4 |
| 04_Immersive_block | QMI8658 accel → LVGL shapes, level calibration | IMU driver reference |
| 05_Spec_Analyzer | ES7210 capture → FFT → 64-bar LVGL canvas | Audio capture + real-time canvas rendering reference |

Pre-built images: GitHub releases (`*-combined.zip`, flash with `flash_combined.sh /dev/ttyACM0`); factory image `firmware/ESP32-S3-Touch-AMOLED-1.75C_FactoryOnly_20260114.bin` (merged, flash at 0x0).

## 4. ESP-Brookesia support

ESP-Brookesia is Espressif's HMI/AIoT platform. Two generations are relevant:

| Generation | Where | IDF | Status | Notes |
| --- | --- | --- | --- | --- |
| `brookesia_core` 0.6.0-beta2 | Vendored in vendor example 03 | ≥ 5.3 | End of maintenance | Monolithic: `systems/phone`, `systems/speaker` (EchoEar "AI buddy"), `ai_framework/agent` (Coze, GMF audio, AFE), `ai_framework/expression` (emoji/icon anim players) |
| `release/v0.7` | [espressif/esp-brookesia](https://github.com/espressif/esp-brookesia) | 5.5 – 6.0 | Bug and security fixes only | Componentised via IDF Component Manager; **board definition for this device included** |
| `master` / 0.8.x | same | 6.0 – 6.2 | Active development; 0.8.x published on the component registry | HAL boards, service framework, agent manager, emote expression, MCP utils, multi-runtime; **board definition for this device included** |

### 4.1 Upstream board definition

Path: `hal/brookesia_hal_boards/boards/waveshare/esp32_s3_touch_amoled_1_75c/` (present on `master` and `release/v0.7`). Snapshot in [reference/brookesia-board-config/](reference/brookesia-board-config/).

- `board_peripherals.yaml` — I²C (SDA 15/SCL 14), I²S (48 kHz, MCLK 16, BCLK 9, WS 45, DOUT 8, DIN 10), PA GPIO46, SPI2 QSPI (4/5/6/7, CLK 38).
- `board_devices.yaml` — ES8311 @0x30(8-bit), ES7210 @0x80, CO5300 (CS 12, RST 1, quad mode, 32-bit cmd), CST9217 @0xB4 (RST 2, INT 11, mirror X/Y), AXP2101 @0x34.
- `sdkconfig.defaults.board` — enables HAL adaptors for audio (codec player/recorder, AFE processor), display (LCD panel, touch, custom AMOLED brightness instead of LEDC), storage (NVS + LittleFS), power (AXP2101 battery), Wi-Fi, SNTP, HTTP client.

### 4.2 Relevant upstream components (v0.8 naming)

| Component | Purpose |
| --- | --- |
| `brookesia_hal_boards`, `brookesia_hal_adaptor`, `brookesia_hal_interface` | Board description → device instances (audio, display, touch, power, storage, Wi-Fi) |
| `brookesia_service_audio` | Recorder/player, AFE (AEC/NS/VAD/WakeNet), encoder/decoder (Opus, G.711, PCM) |
| `brookesia_agent_manager` | Agent lifecycle state machine; base class `agent::Base` with hooks `on_activate/on_startup/on_shutdown/on_sleep/on_wakeup/on_encoder_data_ready/on_interrupt_speaking`; helpers `feed_audio_decoder_data()`, `set_emote()`, `set_agent_speaking_text()`, `set_user_speaking_text()` |
| `brookesia_agent_xiaozhi` / `_openai` / `_coze` | Reference agent backends (XiaoZhi = WebSocket + Opus; OpenAI = Realtime) |
| `brookesia_expression_emote` | Emoji/animation/event-message rendering (`SetEmoji`, `SetAnimation`, `InsertAnimation`, `SetEventMessage`), built on `espressif2022/esp_emote_expression` |
| `brookesia_mcp_utils` | Exposes Brookesia service functions as MCP tools |
| `brookesia_service_wifi`, `_sntp`, `_http`, `_storage` | Connectivity and persistence |
| Example `examples/agent/chatbot` | End-to-end voice agent with emote integration — closest upstream analogue to Homunculus |

## 5. Recommended sdkconfig baseline (Homunculus)

Merged from the vendor example and the Brookesia board config:

```ini
CONFIG_IDF_TARGET="esp32s3"
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_ESPTOOLPY_FLASHFREQ_80M=y
CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y          # raise to 32MB only after esptool flash_id confirms
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_SPIRAM=y
CONFIG_SPIRAM_MODE_OCT=y
CONFIG_SPIRAM_SPEED_80M=y
CONFIG_SPIRAM_FETCH_INSTRUCTIONS=y
CONFIG_SPIRAM_RODATA=y
CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y
CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY=y
CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_240=y
CONFIG_ESP32S3_DATA_CACHE_64KB=y
CONFIG_ESP32S3_DATA_CACHE_LINE_64B=y
CONFIG_ESP32S3_INSTRUCTION_CACHE_32KB=y
CONFIG_FREERTOS_HZ=1000
CONFIG_COMPILER_OPTIMIZATION_PERF=y
CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y
CONFIG_LV_OS_FREERTOS=y
CONFIG_LV_DEF_REFR_PERIOD=15
CONFIG_LV_DRAW_SW_DRAW_UNIT_CNT=2
```

## 6. Partition layout proposal (16 MB)

| Name | Type | Size | Purpose |
| --- | --- | --- | --- |
| nvs | data/nvs | 24 KB | Wi-Fi creds, device token, settings |
| otadata | data/ota | 8 KB | OTA selector |
| phy_init | data/phy | 4 KB | RF calibration |
| ota_0 | app | 4 MB | Firmware slot A |
| ota_1 | app | 4 MB | Firmware slot B |
| model | data/spiffs | 2 MB | ESP-SR models (WakeNet, AFE) |
| assets | data/littlefs (or mmap assets) | ~ 5.9 MB | Avatar animations, sounds, fonts |
