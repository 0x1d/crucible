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
- Warm time-to-first-sentence ≈ 2.1–2.2 s exceeds the §5.5 agent budget (400–800 ms TTFT); web-tool turns ≈ 27 s before any text (R-03: filler phrase / earcon needed).

