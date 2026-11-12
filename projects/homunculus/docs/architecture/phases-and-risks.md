---
id: crucible/homunculus/architecture/phases-and-risks
title: Phases and Risks
type: ARCH
owner: crucible/homunculus
status: Draft
date: 2026-11-11
depends: [crucible/homunculus/architecture]
related: [crucible/homunculus/decisions, crucible/homunculus/open-items]
planned:
  - id: crucible/homunculus/P-01
    title: Multi-device: second board
    depends: []
  - id: crucible/homunculus/P-02
    title: OpenCode backend
    depends: []
---

# Phases and Risks

Repository layout, the phases the project was built in with their exit criteria and state, the risks, and the hardware measurements taken along the way. Open phases are planned changes, declared in the front matter.

## 1 Proposed repository layout

```text
homunculus/
├── docs/                         # this documentation
├── firmware/                     # ESP-IDF project
│   ├── main/                     # app entry, wiring
│   ├── components/
│   │   ├── homunculus_agent/     # agent::Base subclass + HDP client
│   │   ├── homunculus_avatar/    # Phase 2: circular audio visualizer (procedural face deferred)
│   │   ├── homunculus_tools/     # device tool registry
│   │   └── homunculus_boards/    # board extras / overrides (e.g. 1.75C flash size, mic layout)
│   ├── partitions/
│   └── sdkconfig.defaults.<board>
├── server/                       # TypeScript (Node.js >= 22)
│   ├── src/gateway/              # WSS, HDP codec, Opus
│   ├── src/orchestrator/
│   ├── src/inference/            # AgentBackend + claude/ + opencode/
│   ├── src/speech/               # stt/, tts/, vad/, shaper/
│   ├── src/tools/                # avatar MCP, device bridge, meta tools
│   ├── src/memory/               # Phase 3D: temporal-reasoning client, wiki ([crucible/homunculus/server/design/memory](../server/design/memory.md))
│   └── src/admin/
├── protocol/                     # HDP JSON schemas, shared test vectors
└── tools/                        # device simulator (PC client speaking HDP), asset pipeline
```

TypeScript packages form one pnpm workspace (root `pnpm-workspace.yaml`): `protocol` (`@homunculus/protocol`), `server`, `tools/simulator` (`@homunculus/simulator`).

## 2 Phases

| Phase | Exit criteria | Status |
| --- | --- | --- |
| 0 - Spikes | Display + touch + audio running on upstream Brookesia board def; measured AFE CPU load; Claude SDK partial streaming + interrupt verified | **Done 2026-11-07** (section 6) |
| 1 - Voice MVP | Wake word -> answer by voice with web search; barge-in works; latency measured per stage | **Met on hardware 2026-11-08**; in-person checks pending (section 7) |
| 2 - Audio visualizer | Ring waveform follows speaker output >= 15 fps; palette per UI state; speech without stutter [crucible/homunculus/firmware/design/avatar](../firmware/design/avatar.md) section 5) | **Done 2026-11-08**; underruns / CPU during speech not measured |
| 2F - Procedural face (`crucible/homunculus/firmware/P-01`) | All states and emotes rendered >= 20 fps; lip-sync; agent drives emotions ([crucible/homunculus/firmware/design/avatar-face](../firmware/design/avatar-face.md)) | **Deferred** (crucible/homunculus/D-20) |
| 3B - Device tools + confirmations | Agent calls device tools; confirmation flow on the device replaces crucible/homunculus/D-18 | **Done 2026-11-08** (tool calls verified on hardware) |
| 3C - Provisioning, pairing, OTA | Wi-Fi provisioning + server pairing on the device; OTA firmware update | **Done 2026-11-10**: Wi-Fi provisioning (SoftAP + web form); OTA verified on hardware 2026-11-08 (4.7 MB in ~ 90 s, confirmed after reboot into ota_1); pairing verified on hardware 2026-11-10 (mDNS discovery, approval, token delivery, reconnect after server restart, revoke -> 401 -> new code) |
| 3D - Long-term memory | Facts from past sessions answer questions in a new session; preference change + history question; wiki page on request ([crucible/homunculus/server/design/memory](../server/design/memory.md)) | **Done 2026-11-10** (crucible/homunculus/D-23 revised): temporal-reasoning MCP server (stdio child) with per-turn prepare / finalize, proxied `memory` tools, `wiki` tools on request, Claude Code auto-memory off. Verified on hardware 2026-11-10 (speech played through the laptop speaker, section 5 test method): fact stored, recalled after a server restart in a new agent session, change (Berlin -> Hamburg) with history answer, wiki page `entities/sister.md` |
| 3A - OpenCode backend **Planned** P-02 | Backend switchable (Claude / OpenCode) per device profile [crucible/homunculus/server/design](../server/design.md) section 3.3) | **Deferred** (crucible/homunculus/D-22) |
| 4 - Multi-device **Planned** P-01 | Second board with different display shape runs the same firmware and server unchanged | Open |

## 3 Risks

| ID | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R-01 | ESP32-S3 CPU/RAM insufficient for AFE + Opus + Wi-Fi + 30 fps avatar simultaneously | Choppy audio or animation | Measure in Phase 0; dirty-rect rendering; lower fps while listening; single-mic AFE mode |
| R-02 | Brookesia 0.8 API churn (master in active development) | Rework | Pin component versions; isolate Brookesia behind thin adapters |
| R-03 | End-to-end latency > 2.5 s with agent harness overhead | Poor UX | Prewarm, fast model profile, immediate acknowledgement emote/earcon, filler phrases |
| R-04 | Agent harness outputs are long / markdown-heavy | Unnatural speech | Persona system prompt + Speech Shaper + summary-first rule |
| R-05 | Prompt injection via web content leading to side effects | Security | Permission policy, on-device confirmation, default-deny host tools |
| R-06 | Small speaker + enclosure resonance degrade AEC | Barge-in false triggers (measured: 5 VAD starts in 19.6 s of playback at 100 % volume) | AEC tuning, ES8311 output gain limits, VAD thresholds during playback; barge-in via wake word or touch instead of VAD while speaking |
| R-07 | Flash size differs between units or batches (schematic: 16 MB part) | Partition errors | `esptool flash_id` per unit; upstream board definition sets 16 MB, Homunculus overrides to 32 MB (crucible/homunculus/D-06) |
| R-08 | CPU-only STT on the development laptop (Whisper is not natively streaming) exceeds the latency budget | Slow turns during early phases | Small/turbo model with whisper.cpp; measure per stage; move STT to a GPU host later (crucible/homunculus/D-01) |
| R-09 | "Computer" is a common word and may false-trigger during normal conversation or TV | Unwanted activations | Tune WakeNet threshold; optional server-side verification; custom "Hey Claudia" model as fallback (crucible/homunculus/D-03) |

## 4 Measurements

p1d hardware measurements (1.75C, LAN, speech pipeline):

| Question | Trigger | End of speech -> first frame fed (device) | `listen.stop` -> first frame fed |
| --- | --- | --- | --- |
| Capital of Australia | wake word | 2792 ms | 2185 ms |
| Vienna weather (WebSearch) | touch | 2951 ms | 2463 ms |
| Time in Tokyo | touch | 3412 ms | 2873 ms |

- Device feeds first frame 65-69 ms after server send.
- CPU avg/max: idle core0 57/62 %, core1 51/60 %; listening 61/68 %, 56/68 %; speaking 62/69 %, 65/69 %. Internal heap min 50 KB (77 KB idle connected).
- Before crucible/homunculus/D-19: 2 downlink underruns per turn between segments; one late abort -> 79 stale frames dropped.

3C / 3D hardware measurements (1.75C, 2026-11-10): internal free 53 KB offline (pairing), 50 KB idle connected after pairing, 37 KB idle after five turns, minimum 26 KB during turns (p1d: 77 KB idle connected, minimum 50 KB).

Internal RAM after turns (1.75C, 2026-11-10, firmware e43ee76 + heap diagnostics): no leak. With the 24 kHz downlink, idle internal free drops once by 13.6 KB on the first turn (52.1 -> 38.5 KB) and stays at 38.5 KB +/- 0.1 KB over 10 turns; the allocation is the `esp_ae_rate_cvt` FIR tables (24 -> 16 kHz, 2 x 6 436 B + 392 B, internal RAM, kept while the feeder pipeline is open). With the 16 kHz downlink (crucible/homunculus/D-31) idle internal free stays at 51.7 KB over 6 turns, minimum 51.3 KB. Internal task stacks: 87.6 KB [crucible/homunculus/firmware/design](../firmware/design.md) section 2.2).

Speech for hardware tests without a person: Kokoro voice `am_michael`, loudness-normalised (ffmpeg `loudnorm=I=-10`, compressor), played through the laptop speaker at 150 % stream volume (laptop sink 48 %); console key `w` starts listening 0.8 s before playback. 6 of 8 utterances reached the server (2 `no_speech`); transcripts partly wrong ("Anna" -> "came up").

Pending (needs a person): physical tap barge-in while speaking; in-person "Computer" while speaking (AEC); stop latency after barge-in; wake-word false-trigger rate over a long quiet period.
