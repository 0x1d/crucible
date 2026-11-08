# Development Environment

The project is built exclusively with Nix. All toolchains are pinned in `flake.lock`.

## Shells

| Shell | Flake | Classic | Contents |
| --- | --- | --- | --- |
| default | `nix develop` | `nix-shell` | firmware + server tools |
| firmware | `nix develop .#firmware` | `nix-shell -A firmware` | ESP-IDF v6.0.2 (Xtensa + RISC-V toolchains), idf-component-manager 3.x, esptool, OpenOCD, picocom |
| server | `nix develop .#server` | `nix-shell -A server` | Node.js 22, pnpm, libopus, ffmpeg |
| docs | `nix develop .#docs` | `nix-shell -A docs` | mermaid-cli, poppler-utils |

All shells include git, git-lfs, jq and nixfmt. With direnv installed, `direnv allow` loads the default shell automatically (`.envrc`).

ESP-IDF comes from [esp-idf-nix](https://github.com/Cbeck527/esp-idf-nix) (`lib.mkEspIdfEnv`, version pinned in `flake.nix`). ESP-Brookesia 0.8 requires ESP-IDF ≥ 6.0, ≤ 6.2 on ESP32-S3.

Binary cache: `https://esp-idf-nix.cachix.org` (declared in `nixConfig`). It is used only if your user is a trusted Nix user or the substituter is added system-wide:

```nix
nix.settings = {
  extra-substituters = [ "https://esp-idf-nix.cachix.org" ];
  extra-trusted-public-keys = [ "esp-idf-nix.cachix.org-1:6qHkAxmub00GqSujpkTqbL3XZvT6d4g8/13FcL+wrpQ=" ];
};
```

## Checks and formatting

```bash
nix flake check
```

```bash
nix fmt
```

## Flashing on NixOS

The reference device enumerates as `/dev/ttyACM0` (native USB-Serial/JTAG). Your user needs to be in the `dialout` group:

```nix
users.users.<name>.extraGroups = [ "dialout" ];
```

## Firmware

```bash
cd firmware
idf.py gen-bmgr-config -b esp32_s3_touch_amoled_1_75c
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
```

Development flash (`make fw-flash`, `firmware/flash-app.sh`): builds, then writes only the app image with `esptool write-flash --diff-with build/last-flashed-app.bin` (only changed 4 KB sectors). `idf.py flash` (`make fw-flash-full`) also writes the bootloader, partition table, `model` and the 16 MB `littlefs_data` image (~50 s of ~90 s); needed on a fresh board or after partition / bootloader changes.

Measured (i7-1165G7, USB-Serial-JTAG): link of `homunculus.elf` ~85 s, single-threaded, CPU-bound; unchanged by dropping `--cref` or debug info. App image 4.5 MB: ~34 s full write.

`gen-bmgr-config` generates `components/gen_bmgr_codes/` (git-ignored) from the Brookesia board definition; run it once per checkout or board change. Component versions are locked in `firmware/dependencies.lock`.

Per-machine settings go into the git-ignored `firmware/sdkconfig.local` (appended to `SDKCONFIG_DEFAULTS` if present):

```text
CONFIG_HOMUNCULUS_WIFI_SSID="..."
CONFIG_HOMUNCULUS_WIFI_PASSWORD="..."
CONFIG_HOMUNCULUS_SERVER_URL="ws://<server-lan-ip>:8443/hdp"
```

Defaults only fill keys missing from `sdkconfig`: after editing, delete the keys from `sdkconfig` or run `idf.py menuconfig`, then `idf.py reconfigure`.

HDP codec host test (protocol vectors, needs `managed_components`):

```bash
firmware/components/homunculus_agent/test/host/run.sh
```

Ring visualizer rasteriser host test (spec 06; optional argument writes a PPM contact sheet of flat, speech and recovered frames):

```bash
firmware/components/homunculus_avatar/test/host/run.sh /tmp/ring.ppm
```

Development console (`CONFIG_HOMUNCULUS_DEV_CONSOLE`, USB-Serial-JTAG, e.g. in `idf.py monitor`): `t` tap, `w` wake word, `s` CPU / heap / stack / per-task CPU stats, `v` visualizer test tone (5 s), `r` HDP reconnect (session resume), `d` Wi-Fi disconnect. Serial capture without resetting the board: open `/dev/ttyACM0` with DTR and RTS deasserted (pyserial `dtr=False`, `rts=False` before `open()`).

Device log lines: `hom_agent: uplink: ...` (per utterance), `hom_agent: turn: after listen.stop: tts_start, first_rx, first_fed, play_end` (ms), `[stats] ui, cpu core0/core1 %, internal free (min), stack min free` every `CONFIG_HOMUNCULUS_SYSTEM_STATS_INTERVAL_S`.

## Server

pnpm workspace at the repository root: `protocol`, `server`, `tools/simulator`.

```bash
pnpm install
pnpm typecheck
pnpm test
```

```bash
pnpm --filter homunculus-server dev
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMUNCULUS_PORT` | `8443` | Listen port |
| `HOMUNCULUS_HOST` | `0.0.0.0` | Listen address |
| `HOMUNCULUS_DEVICE_TOKENS` | unset → `dev` (plain ws only) | Comma-separated device bearer tokens |
| `HOMUNCULUS_TLS_CERT`, `HOMUNCULUS_TLS_KEY` | unset | PEM paths; enables `wss://` |
| `HOMUNCULUS_LOG_LEVEL` | `info` | `debug` logs every HDP message |
| `HOMUNCULUS_LOG` | text | `json` for JSON lines |
| `HOMUNCULUS_PIPELINE` | `speech` | `speech` or `loopback` (echo) |
| `HOMUNCULUS_PERSONA` | `claudia` | Persona file `server/personas/<id>.json` |
| `HOMUNCULUS_MODEL`, `HOMUNCULUS_EFFORT` | `claude-opus-5-5`, `low` | Agent model and effort |
| `HOMUNCULUS_MODEL_DIR` | `server/models` | Model cache (`pnpm --filter homunculus-server exec tsx scripts/fetch-models.ts`) |
| `HOMUNCULUS_OFFLINE` | unset | `1`: no Hugging Face downloads |
| `HOMUNCULUS_WHISPER_MODEL` | `base.en` | ggml model name or path |
| `HOMUNCULUS_WHISPER_URL`, `HOMUNCULUS_WHISPER_BIN` | unset, `whisper-server` | Use a running whisper-server / binary path |
| `HOMUNCULUS_WHISPER_THREADS` | `4` | whisper-server threads |
| `HOMUNCULUS_STT_PARTIAL_MS` | `1000` | Audio between partial transcriptions; `0` disables |
| `HOMUNCULUS_TTS`, `HOMUNCULUS_TTS_VOICE` | persona | `kokoro` or `piper`; voice |
| `HOMUNCULUS_TTS_GAIN_DB` | `0` | TTS output gain with soft limiter (ceiling −0.3 dBFS); `0` disables |
| `HOMUNCULUS_KOKORO_DTYPE` | `fp32` | Kokoro ONNX weights (`q8` is slower on x86, spec §5.4.2) |
| `HOMUNCULUS_PIPER_BIN` | `piper` | Piper binary |
| `HOMUNCULUS_VAD_HANGOVER_MS`, `HOMUNCULUS_VAD_THRESHOLD` | `600`, `0.5` | Endpointing |
| `HOMUNCULUS_FIRST_MIN_WORDS`, `HOMUNCULUS_FIRST_MAX_WORDS` | `3`, `8` | First speech segment length (spec §5.4.2) |
| `HOMUNCULUS_UPLINK_GAP_MS` | `2500` | Uplink silence (no frames) that ends an utterance |
| `HOMUNCULUS_STT_TIMEOUT_MS` | `20000` | Max wait for the final transcript |
| `HOMUNCULUS_AGENT_IDLE_TIMEOUT_MS` | `90000` | Max time between agent events |
| `HOMUNCULUS_SPEECH_IDLE_TIMEOUT_MS` | `20000` | Max time without TTS/downlink progress |
| `HOMUNCULUS_INTERRUPT_WAIT_MS` | `8000` | Max wait for an interrupted agent stream before the session is reopened |

Per-device agent sandbox: `server/.data/sandbox/devices/<sanitised-device-id>-<hash>/`.

Kokoro benchmark (synthesis time and whisper WER per dtype; writes `server/.data/bench-tts/*.wav`):

```bash
pnpm --filter homunculus-server exec tsx scripts/bench-tts.ts fp32,q8 3 bf_emma
```

Server tests (`server/test/*.test.ts`, node:test): orchestrator FSM, speech output, endpointer, Opus framing, whisper stream, gateway and pipeline run against fakes (`server/test/fakes.ts`); `speech-models.test.ts` uses the real models and is skipped when they are missing.

Claude SDK spike: `pnpm --filter homunculus-server spike:claude`.

After editing `protocol/src/messages.ts`: `pnpm --filter @homunculus/protocol gen:schema`.

## Device simulator

```bash
pnpm --filter @homunculus/simulator sim --out /tmp/replies talk question.wav
```

```bash
pnpm --filter @homunculus/simulator sim --play
```

Interactive commands: `talk <file> [manual]`, `ptt` (default mic, Enter ends), `abort`, `event <name> [json]`, `yes`/`no`, `quit`. `--help` lists options. Audio input via ffmpeg (any format; mic via PulseAudio/PipeWire), playback via `aplay` (override with `--player` or `HDP_SIM_PLAYER`).

Claude auth: `ANTHROPIC_API_KEY` if set, otherwise the logged-in Claude subscription.

## Git LFS

Binary assets (`*.pdf`, `*.png`, `*.jpg`, `*.webp`, `*.bin`, `*.zip`) are stored in Git LFS. The dev shells provide `git-lfs` and run `git lfs install --local` on entry; outside a shell, git operations on this repository need `git-lfs` on the PATH.

## Reproducible builds (planned)

Once firmware and server code exist, they will be exposed as flake packages (`nix build .#firmware-<board>`, `nix build .#server`). ESP-IDF component-manager dependencies (`managed_components/`) will need to be vendored or fixed-output fetched, since Nix builds have no network access.
