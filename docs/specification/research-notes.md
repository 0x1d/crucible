# Research Notes

Background findings collected on 2026-11-07 that inform the specification.

## R1. ESP-Brookesia

- Repository: <https://github.com/espressif/esp-brookesia>; docs: <https://docs.espressif.com/projects/esp-brookesia/en/latest/>.
- Version matrix (getting-started guide, 2026-11-07): `master` / 0.8.x (ESP32-S31: IDF 6.2; other chips incl. ESP32-S3: IDF ≥ 6.0, ≤ 6.2; 0.8.x published on the component registry), `release/v0.7` (IDF ≥ 5.5, ≤ 6.0, bug and security fixes only), `release/v0.6` (IDF 5.3–5.5, end of maintenance).
- Layers: HAL (`brookesia_hal_interface`, `_adaptor`, `_boards`, Linux/WASM simulation), Services (50+, incl. audio, display, Wi-Fi, SNTP, HTTP, storage), Agents (`brookesia_agent_manager`, `_coze`, `_openai`, `_xiaozhi`), Expression (`brookesia_expression_emote` on `espressif2022/esp_emote_expression`), GUI (`brookesia_gui_interface` JSON UI, `brookesia_gui_lvgl`), Runtimes (ELF, JS, Lua, WASM), System (`brookesia_system_core`, `_super`), Utils (`brookesia_lib_utils`, `brookesia_mcp_utils`).
- **Board support for the ESP32-S3-Touch-AMOLED-1.75C exists upstream** (`hal/brookesia_hal_boards/boards/waveshare/esp32_s3_touch_amoled_1_75c`, on `master` and `release/v0.7`). Verified on hardware 2026-11-07 with `release/v0.7` `examples/service/device` (IDF 5.5.2): ES8311, ES7210, CO5300 and 8 MB PSRAM initialise.
- `esp_board_manager` uses Kconfig-conditional dependencies; requires idf-component-manager ≥ 2.4 (2.2.2 fails with `MissingKconfigError`).
- `agent_manager` `agent::Base` virtual hooks: `on_activate`, `on_startup`, `on_shutdown`, `on_sleep`, `on_wakeup`, `on_manual_start_listening`, `on_manual_stop_listening`, `on_suspend`, `on_resume`, `on_interrupt_speaking`, `on_encoder_data_ready`, `set_info`, `reset_data`. Helpers for agents: `feed_audio_decoder_data`, `set_emote`, `set_agent_speaking_text`, `set_user_speaking_text`, `trigger_general_event`. Audio config: encoder/decoder dynamic configs (XiaoZhi agent uses Opus/G.711/PCM over WebSocket).
- Example `examples/agent/chatbot` shows emote wiring for every agent event (listening, speaking, text, emote, battery).
- The vendor example `03_esp-brookesia` vendors `brookesia_core` 0.6.0-beta2 whose agent (`ai_framework/agent`) is Coze-specific and uses ESP-GMF + AFE (`AFE_TYPE_SR`, `AFE_MODE_HIGH_PERF`, VAD mode 3, AEC, WakeNet, AGC; PSRAM-heavy allocation). Its `Expression` class (emoji → emotion + icon animation players) is the predecessor of the emote service.

## R2. XiaoZhi (xiaozhi-esp32)

- MIT-licensed ESP32 voice-agent firmware: <https://github.com/78/xiaozhi-esp32>. Supports WebSocket or MQTT+UDP, Opus streaming, ESP-SR wake word, device-side MCP, emoji display. Multiple self-hostable servers exist (Python, Java, Go).
- WebSocket protocol (docs/websocket.md): handshake headers `Authorization`, `Protocol-Version`, `Device-Id`, `Client-Id`; device `hello` with `audio_params` (Opus, 16 kHz, mono, 60 ms) and `features` (`mcp`, `aec`); server `hello` with `session_id` and downlink audio params (often 24 kHz); messages `listen` (start/stop/detect, modes auto/manual/realtime), `stt`, `tts` (start/sentence_start/stop), `llm` (emotion), `mcp` (JSON-RPC 2.0), `abort`; binary protocol v1/v2/v3.
- Board list includes Waveshare ESP32-S3-Touch-AMOLED-1.8 but not the 1.75C (as of retrieval). Waveshare offers XiaoZhi firmware v2.4.0 for the 1.75C.
- Adopted for Homunculus: message vocabulary and audio parameters as the base of HDP; extended for avatar, agent status, confirmations, capabilities.

## R3. Claude Agent SDK

- Packages: `@anthropic-ai/claude-agent-sdk` (TypeScript), `claude-agent-sdk` (Python). Runs Claude Code's agent loop as a library: built-in tools (file, shell, web search/fetch), hooks, subagents, MCP, permissions, sessions, skills/plugins.
- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options })` → `Query` (async generator of `SDKMessage`) with `interrupt()`, `setPermissionMode()`, `setModel()`, `setMcpServers()`, `close()`.
- Relevant options: `systemPrompt` (custom string or `{type:'preset', preset:'claude_code', append}`), `model`, `allowedTools`, `disallowedTools`, `permissionMode` (`default`/`auto`/`plan`/`bypassPermissions`), `canUseTool`, `mcpServers`, `resume`, `continue`, `forkSession`, `includePartialMessages`, `abortController`, `settingSources`, `cwd`, `maxTurns`.
- In-process tools: `createSdkMcpServer({ name, tools })` + `tool(name, description, zodShape, handler)`.
- Latency helpers: `startup()` / `prewarm()` to keep a warm process.
- Terms: API-key auth required for third-party products (no claude.ai login); branding: "X powered by Claude" allowed, "Claude Code" not.

## R4. OpenCode SDK

- Package `@opencode-ai/sdk`; `createOpencode()` (starts server + client) or `createOpencodeClient()` (connect to `opencode serve`).
- Sessions: `session.create`, `session.prompt({ path:{id}, body:{ parts, model:{providerID, modelID}, agent, system, tools, noReply } })`, `session.messages`, `session.abort`.
- Events: `event.subscribe()` SSE stream (`message.part.updated`, `session.idle`, permission events); permission replies through the session permissions endpoint.
- Providers configurable (incl. local models), MCP servers via OpenCode config → enables fully local operation.

## R5. Speech

- On-device (ESP-SR): AFE (AEC, NS, AGC, VAD), WakeNet (wake words), MultiNet (command words only — not general STT). Hence general STT must be server-side.
- Server STT candidates: faster-whisper, whisper.cpp, NVIDIA Parakeet/Canary (local); Deepgram, AssemblyAI, ElevenLabs Scribe, OpenAI (cloud).
- Server TTS candidates: Kokoro, Piper (local); ElevenLabs, Cartesia, OpenAI TTS (cloud).
- VAD/endpointing: Silero VAD on server; AFE VAD on device for barge-in.

## R6. Related community projects on this board

- Claude Desktop Buddy port for the 1.75C — <https://github.com/vthinkxie/claude-desktop-buddy-esp32>
- Muse Gadgets — on-screen avatar + push-to-talk on the 1.75C — <https://github.com/facebookincubator/muse-gadget-sdk/blob/main/esp32/devices/README.md>
- Codex Island for Waveshare 1.75C — <https://github.com/WildBeast114514/codex-island-waveshare>

These are worth reviewing for practical display/audio tricks on this exact hardware before implementing the avatar engine.

## Phase 0 measurements

### p0c — Claude Agent SDK streaming spike (2026-11-07)

`server/src/spikes/claude-streaming.ts`; `@anthropic-ai/claude-agent-sdk` 0.3.319; `claude-opus-5-5`, effort `low`; tools `WebSearch`, `WebFetch`; auth: Claude subscription login; one streaming-input `query()` per session.

| Turn | First text | First sentence | Total | Notes |
| --- | --- | --- | --- | --- |
| Cold (process start) | 1941 ms | 3333 ms | 3359 ms | |
| Warm | 1816 ms | 2196 ms | 5988 ms | |
| Long answer, interrupted at 3000 ms | 1926 ms | 2926 ms | 3013 ms | `Query.interrupt()` → turn ended 13 ms later; result reported, session reusable |
| After interrupt (with heard-so-far) | 1698 ms | 2095 ms | 6064 ms | Agent correctly recalled the interrupted content |
| Weather (web) | 26642 ms | 26643 ms | 28747 ms | WebSearch → WebFetch → WebSearch; no text before tools |

- Partial streaming (`includePartialMessages`) delivers `text_delta` events; `server_tool_use`/`tool_use` block starts give tool events.
- Warm time-to-first-sentence ≈ 2.1–2.2 s exceeds the §5.5 agent budget (400–800 ms TTFT); web-tool turns ≈ 27 s before any text (R-03: filler phrase / earcon needed).- Rerun with D-09 voice rule (announce before web tools): weather turn first text 2257 ms, first sentence 3199 ms ("Let me look that up for you."), total 27726 ms.

### OI-04 — `brookesia_agent_xiaozhi` with a custom server (Brookesia master `cec3a3b`, `espressif/esp_xiaozhi` 0.1.3~1)

- Endpoint source: build-time `CONFIG_XIAOZHI_OTA_URL` (default `https://api.tenclass.net/xiaozhi/ota/`). No runtime/NVS override.
- Every boot: `XiaoZhi::on_activate()` → `esp_xiaozhi_chat_get_info()` POSTs board JSON (headers `Client-Id`, `Device-Id`, `User-Agent`) to the OTA URL; retries every 15 s until it succeeds. HTTP status not checked; non-empty JSON parsed. `Activated` fires when the response has no `activation.code`/`activation.challenge`. Not bypassable by config.
- Response `websocket{url,token,version}` / `mqtt{...}` stored in NVS. Transport: MQTT+UDP if `mqtt` present, else WebSocket.
- WebSocket headers: `Authorization: Bearer <token>` (omitted if empty), `Protocol-Version`, `Device-Id` (MAC), `Client-Id` (UUID). TLS via CA bundle; `ws://` accepted. Reconnect every 5 s.
- Client hello: `{"type":"hello","version":1,"transport":"websocket","features":{"mcp":true},"audio_params":{"format":"opus","sample_rate":16000,"channels":1,"frame_duration":60}}`. Server hello must contain `transport`; `session_id`, `audio_params` optional.
- Custom server requirements: (a) POST OTA stub returning `{"websocket":{"url":"wss://<host>/ws","token":"<t>","version":1}}` without `activation`/`mqtt`; (b) WebSocket endpoint implementing XiaoZhi hello/listen/stt/tts/llm/abort/mcp + Opus frames.
- Upstream board definition (1.75C): `CONFIG_ESPTOOLPY_FLASHSIZE_16MB`, octal PSRAM, recorder 32-bit / 2 ch / 16 kHz, `MIC_LAYOUT="RMNN"`, gain 36 dB; ES7210 `adc_channel_mask` `0111`; I2S0 48 kHz 16-bit.

### p0a — Brookesia 0.8 on the 1.75C (2026-11-07)

- `examples/agent/chatbot` (Brookesia master `cec3a3b`, XiaoZhi 0.8.2, Emote 0.8.2) built with ESP-IDF 6.0.2 + idf-component-manager 3.1.2 for `esp32_s3_touch_amoled_1_75c`; flashed and boots.
- Running: service manager, Emote service + assets, Wi-Fi SoftAP provisioning (`ESP-AP-<mac>`, open, `192.168.4.1:80`, QR code on screen).
- One `Failed to read touch data` (`ESP_ERR_INVALID_RESPONSE`) at boot; not repeated in 45 s.
- Image uses the board default flash size (16 MB).

### p0a/p0b — Homunculus bench firmware (2026-11-07)

`firmware/` (`main/main.cpp`): Brookesia 0.8 registry components, ESP-IDF 6.0.2, 32 MB flash, WakeNet `wn9_computer_tts`, 240 MHz dual core.

| Item | Result |
| --- | --- |
| Display | CO5300 466×466 RGB565 via HAL `PanelIface`; colour bars drawn |
| Touch | CST9217, 5 points, interrupt mode; 3/3 taps, 0 read errors. Polling without INT → `ESP_ERR_INVALID_RESPONSE` on every read |
| Wake word | `["Computer"]` loaded; events `WakeStart`, `VAD_Start`, `VAD_End`, `WakeEnd` |
| Opus uplink | 16 kHz mono, 60 ms, VBR 24 kbit/s target → 332 frames / 20 s, 22 kbit/s measured |
| Full duplex | AFE + Opus encode while decoding/playing 20 s of Opus; playback drained |

CPU load per core (100 − idle task share):

| Phase | Core 0 | Core 1 |
| --- | --- | --- |
| A: idle (services up, display static) | 14 % | 10 % |
| B: AFE (AEC/NS/VAD/WakeNet, 1 mic + ref) + Opus encode | 48 % | 30 % |
| C: B + Opus decode + playback | 52 % | 40 % |

Main tasks in C (share of both cores): `audio_recorder_` 11 % (core 0), `afe_feed` 8 % (core 1), `afe_fetch` 5 % (core 0).

Heap: internal free 254 KB at boot, 178 KB minimum during C; PSRAM free 5.2 MB at boot, 4.2 MB minimum.

Shutdown errors (harmless for the bench): `esp_gmf_pipeline_destroy: Got NULL Pointer`, `i2s_channel_disable: channel has not been enabled yet`.

