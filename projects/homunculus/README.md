# Homunculus

Physical AI companion on ESP32 devices: an animated avatar that listens, thinks and talks, backed by a server-side agent (Claude Agent SDK) with local speech-to-text (whisper.cpp) and text-to-speech (Kokoro / Piper).

Reference device: Waveshare ESP32-S3 Touch AMOLED 1.75C. Docs: [docs/](docs/README.md), [development environment](docs/development.md).

## Quickstart

Requirements: [Nix](https://nixos.org/) with flakes enabled, a Claude login (`ANTHROPIC_API_KEY` or a logged-in Claude subscription), and the device connected via USB (your user in `dialout` on Linux). Every `make` target enters the right `nix develop` shell itself.

```bash
make help          # list all targets
```

1. **One-time setup** — JS dependencies, speech models, board config:

   ```bash
   make setup
   ```

2. **Start the backend** (listens on `ws://0.0.0.0:8443/hdp`; leave running):

   ```bash
   make server
   ```

3. **Configure the device** — create `firmware/sdkconfig.local` (git-ignored) with your Wi-Fi and the server's LAN address:

   ```text
   CONFIG_HOMUNCULUS_WIFI_SSID="..."
   CONFIG_HOMUNCULUS_WIFI_PASSWORD="..."
   CONFIG_HOMUNCULUS_SERVER_URL="ws://<server-lan-ip>:8443/hdp"
   ```

4. **Build, flash and monitor**:

   ```bash
   make fw-flash-full      # first time on a board: all partitions
   make fw-flash-monitor   # afterwards: only changed app sectors, then monitor
   ```

   Use `PORT=/dev/ttyACM1` for a different serial port. Exit the monitor with `Ctrl-]`.

No device? Talk to the backend with the simulator (second terminal):

```bash
make sim-play
```

## Targets

| Target | Action |
| --- | --- |
| `setup` | `deps` + `models` + `fw-config` |
| `models-piper` | Also fetch the Piper TTS fallback voice |
| `fw-config` / `fw-build` / `fw-flash` / `fw-flash-full` / `fw-monitor` / `fw-flash-monitor` | Firmware build and flash (`BOARD`, `PORT` overridable) |
| `fw-publish` | Build and copy the image to `server/.data/ota/` for OTA ("update your firmware", console key `u`) |
| `fw-menuconfig` / `fw-clean` / `fw-test` | Config UI, clean, host tests |
| `server` (`backend`) | Run the backend |
| `sim` / `sim-play` | Device simulator |
| `typecheck` / `test` / `check` | Checks |

Server configuration is by `HOMUNCULUS_*` environment variables, e.g. `HOMUNCULUS_PERSONA=claudia make server`; see [docs/development.md](docs/development.md).
