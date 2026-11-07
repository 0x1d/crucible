# 2. System Architecture

| | |
| --- | --- |
| Document | HOM-SPEC-02 |
| Status | Draft 0.1 |

## 2.1 System context

```mermaid
flowchart LR
    User(["User"])
    subgraph Home["Local network"]
        Dev1["Homunculus device<br/>ESP32-S3 AMOLED 1.75C"]
        Dev2["Homunculus device<br/>(other ESP32 board)"]
        Srv["Homunculus Server"]
    end
    LLM["LLM providers<br/>Anthropic API, OpenCode providers"]
    Speech["Speech providers (optional cloud)<br/>STT / TTS APIs"]
    Web["Internet<br/>web search, fetch, APIs"]
    MCP["MCP servers<br/>calendar, home automation, ..."]

    User -- "voice, touch, motion" --> Dev1
    Dev1 -- "speech, avatar" --> User
    Dev1 <-- "WSS: HDP (Opus + JSON)" --> Srv
    Dev2 <-- "WSS: HDP" --> Srv
    Srv --> LLM
    Srv --> Speech
    Srv --> Web
    Srv --> MCP
```

## 2.2 Responsibility split

| Concern | Device | Server |
| --- | --- | --- |
| Audio capture, AEC, NS, AGC | ✅ (ESP-SR AFE, hardware echo reference) | — |
| Wake word | ✅ (WakeNet, local, privacy-preserving) | optional verification |
| Voice activity detection | ✅ coarse (AFE VAD for barge-in / end-of-speech hint) | ✅ authoritative (Silero VAD / STT endpointing) |
| Audio encoding | ✅ Opus encode (uplink) / decode (downlink) | ✅ Opus decode / encode |
| Speech-to-text | — | ✅ |
| Agent reasoning, tools, internet, memory | — | ✅ |
| Speech-friendly text shaping, sentence segmentation | — | ✅ |
| Text-to-speech | — | ✅ |
| Emotion selection | — | ✅ (agent tool + heuristics) |
| Avatar rendering, lip-sync, idle behaviours | ✅ | — |
| Local tools (volume, brightness, display text/QR, sensors) | ✅ executes | ✅ exposes to agent via MCP bridge |
| Provisioning, OTA | ✅ client | ✅ server |

Rationale: the ESP32-S3 has ~ 8 MB PSRAM and two 240 MHz cores — sufficient for real-time audio DSP, Opus and 2D animation, insufficient for any useful language model. Keeping the device protocol-thin makes adding new boards cheap.

## 2.3 Container view

```mermaid
flowchart TB
    subgraph Device["Device firmware (ESP-IDF + ESP-Brookesia)"]
        direction TB
        HAL["Board HAL<br/>brookesia_hal_boards"]
        AudioSvc["Audio service<br/>AFE, WakeNet, Opus"]
        Agent["Homunculus agent<br/>(agent::Base subclass)"]
        Avatar["Avatar engine<br/>LVGL + emote"]
        Input["Input service<br/>touch, buttons, IMU"]
        DevTools["Device tool registry<br/>(MCP-style)"]
        Net["Connectivity<br/>Wi-Fi, WSS client, OTA"]
        HAL --> AudioSvc & Avatar & Input
        AudioSvc <--> Agent
        Agent --> Avatar
        Input --> Agent
        Agent <--> DevTools
        Agent <--> Net
    end

    subgraph Server["Homunculus Server (TypeScript / Node.js)"]
        direction TB
        GW["Device Gateway<br/>WSS, auth, HDP codec"]
        Reg["Device Registry<br/>capabilities, profiles"]
        Orch["Conversation Orchestrator<br/>turn state machine, barge-in"]
        SpeechIn["Speech-In pipeline<br/>Opus decode, VAD, STT"]
        SpeechOut["Speech-Out pipeline<br/>text shaper, TTS, Opus encode"]
        IAL["Inference Abstraction Layer"]
        CAS["Claude Agent SDK adapter"]
        OCA["OpenCode SDK adapter"]
        ToolHub["Tool Hub<br/>device MCP bridge, avatar tool, MCP servers"]
        Store[("Session and config store<br/>SQLite")]
        GW <--> Orch
        GW --- Reg
        Orch --> SpeechIn
        Orch --> SpeechOut
        Orch <--> IAL
        IAL --> CAS & OCA
        CAS & OCA <--> ToolHub
        Orch --- Store
        Reg --- Store
    end

    Net <== "WSS / HDP" ==> GW
```

## 2.4 End-to-end turn sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant D as Device
    participant G as Gateway / Orchestrator
    participant S as STT
    participant A as Agent backend
    participant T as TTS

    U->>D: "Hey Homunculus"
    D->>D: WakeNet detects wake word
    D->>G: listen.start (mode=auto, wake word)
    D->>D: avatar := listening
    loop every 60 ms
        D->>G: Opus frame (uplink)
        G->>S: PCM stream
        S-->>G: partial transcript
        G-->>D: stt.partial (optional captions)
    end
    S-->>G: final transcript (endpoint detected)
    G->>D: listen.stop + avatar.state = thinking
    G->>A: prompt(transcript, session)
    A-->>G: status: tool_use(web_search)
    G->>D: avatar.state = working (tool: web_search)
    A-->>G: text delta(s)
    G->>G: shape text, segment into sentences
    G->>D: avatar.emote = happy
    G->>T: sentence 1
    T-->>G: PCM chunks
    G->>D: tts.start + Opus frames (downlink)
    D->>D: avatar := speaking, lip-sync from PCM envelope
    A-->>G: more text / done
    G->>T: sentence n
    T-->>G: PCM
    G->>D: Opus frames, tts.stop
    D->>D: avatar := idle (or listening if follow-up mode)
```

## 2.5 Barge-in sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant D as Device
    participant G as Orchestrator
    participant A as Agent backend
    participant T as TTS

    G->>D: Opus frames (agent speaking)
    U->>D: starts talking
    D->>D: AFE (with AEC) VAD = speech, or wake word, or touch
    D->>D: stop playback, flush jitter buffer
    D->>G: abort (reason = barge_in) + listen.start
    G->>T: cancel synthesis
    G->>A: interrupt / cancel current turn
    G->>G: mark spoken-so-far text in session (truncate history)
    D->>G: Opus frames (new utterance)
```

The spoken-so-far bookkeeping matters: the agent must know which part of its answer the user actually heard. The orchestrator records the last sentence fully played (device reports `tts.played` with the sentence id) and appends a note to the agent context on the next turn.

## 2.6 Deployment view

```mermaid
flowchart LR
    subgraph LAN["Home LAN"]
        D1["Device(s)"]
        subgraph Host["Server host (Linux, docker-compose)"]
            HS["homunculus-server<br/>Node.js"]
            STT["stt worker<br/>faster-whisper / Parakeet<br/>(GPU optional)"]
            TTS["tts worker<br/>Kokoro / Piper"]
            OC["opencode serve<br/>(when OpenCode backend used)"]
            DB[("SQLite volume")]
        end
    end
    Cloud["Anthropic API / other LLM APIs<br/>cloud STT/TTS (optional)"]
    D1 -- "wss://host:8443/hdp" --> HS
    HS --> STT & TTS & OC
    HS --> DB
    HS --> Cloud
    OC --> Cloud
```

- Speech workers are optional sidecars; cloud providers can replace them by configuration.
- mDNS (`_homunculus._tcp`) advertisement allows devices to discover the server on the LAN; a fixed URL can be provisioned for remote servers.

## 2.7 Architectural decisions (summary)

| ID | Decision | Rationale | Alternatives considered |
| --- | --- | --- | --- |
| AD-01 | Device is a thin real-time terminal; all AI on server | MCU resources; provider flexibility | On-device STT (ESP-SR MultiNet: command words only — insufficient) |
| AD-02 | ESP-IDF + ESP-Brookesia (componentised, v0.7 → v0.8) as firmware base | Official board definition exists for the reference device; agent manager, AFE, emote and HAL are reusable | Vendored brookesia_core 0.6 (end of maintenance); xiaozhi-esp32 fork (no 1.75C board, different architecture) |
| AD-03 | WebSocket (WSS) transport, Opus audio, JSON control | Proven by XiaoZhi ecosystem; works through NAT/proxies; one connection | MQTT + UDP (more moving parts), WebRTC (heavy on MCU) |
| AD-04 | Cascaded pipeline STT → agent → TTS | Agent SDK harnesses are text-based; needed for tools and provider choice | Speech-to-speech realtime models (no agent harness/tools parity) — possible future backend |
| AD-05 | Server in TypeScript (Node.js ≥ 22) | Both Claude Agent SDK and OpenCode SDK are first-class in TypeScript | Python (Claude SDK yes, OpenCode SDK no) |
| AD-06 | Emotions selected by the agent via a dedicated tool, complemented by orchestrator heuristics | Explicit, testable, provider-independent | Inline markup tags in text; sentiment classifier |
| AD-07 | Capability negotiation in `hello` for multi-device support | New boards need only a board definition + capability descriptor | Per-board server code |
