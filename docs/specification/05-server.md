# 5. Server

| | |
| --- | --- |
| Document | HOM-SPEC-05 |
| Status | Draft 0.1 |
| Runtime | Node.js ≥ 22 (TypeScript), optional Python sidecars for local speech models |

## 5.1 Components

```mermaid
flowchart LR
    subgraph Edge
        GW["Device Gateway<br/>WSS, auth, HDP codec,<br/>Opus encode/decode"]
    end
    subgraph Core
        ORCH["Conversation Orchestrator<br/>per-device turn FSM"]
        REG["Device Registry"]
        SESS["Session Manager"]
    end
    subgraph Speech
        VAD["VAD / Endpointing<br/>(Silero)"]
        STT["STT Provider API"]
        SHAPER["Speech Shaper<br/>markdown strip, segmenter"]
        TTS["TTS Provider API"]
    end
    subgraph Inference["Inference Abstraction Layer"]
        IAL["AgentBackend interface"]
        CLA["ClaudeAgentBackend<br/>@anthropic-ai/claude-agent-sdk"]
        OPC["OpenCodeBackend<br/>@opencode-ai/sdk"]
        FUT["(future) Realtime / API backends"]
    end
    subgraph Tools["Tool Hub"]
        AVT["avatar MCP server<br/>(in-process)"]
        DEVB["device MCP bridge<br/>(in-process)"]
        EXT["external MCP servers"]
    end
    GW <--> ORCH
    ORCH --- REG & SESS
    ORCH --> VAD --> STT
    ORCH --> SHAPER --> TTS
    ORCH <--> IAL
    IAL --> CLA & OPC & FUT
    CLA & OPC --> AVT & DEVB & EXT
    DEVB -. "tool.call via HDP" .-> GW
    AVT -. "avatar events" .-> ORCH
```

| Component | Responsibility |
| --- | --- |
| Device Gateway | Terminates WSS, authenticates devices, parses HDP, Opus ↔ PCM, back-pressure, per-connection jitter/pacing of downlink frames (real-time pacing at 60 ms) |
| Device Registry | Device identity, model, capabilities from `hello`, per-device profile (persona, voice, language, backend, tool policy) |
| Session Manager | Maps device ↔ agent session ids; persistence in SQLite; resume on reconnect |
| Conversation Orchestrator | Turn state machine; routes audio to STT, transcripts to agent, agent output to shaper/TTS; handles barge-in, cancellation, spoken-so-far tracking, avatar state derivation |
| Speech providers | Pluggable STT, TTS, VAD implementations behind small interfaces |
| Inference Abstraction Layer | Uniform streaming agent interface over different agent harnesses |
| Tool Hub | Assembles the tool set per device: avatar tool, device tools bridge, configured MCP servers, permission policy |

## 5.2 Orchestrator turn state machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Listening: listen.start
    Listening --> Transcribing: endpoint (server VAD) or listen.stop (manual)
    Listening --> Idle: no speech / abort
    Transcribing --> Idle: empty transcript
    Transcribing --> Running: final transcript
    Running --> Running: tool_use / text deltas (forward status, emotes)
    Running --> Speaking: first speakable sentence ready
    Speaking --> Speaking: more segments
    Speaking --> Idle: agent done and all segments played
    Running --> Idle: agent done, nothing to say
    Speaking --> Listening: barge-in (abort + listen.start)
    Running --> Listening: barge-in
    Running --> Error: backend failure
    Error --> Idle: error emote + spoken apology
```

Turn pipelining: TTS of sentence *n* runs while the agent still generates sentence *n+1*; the downlink is streamed as soon as the first TTS chunk exists.

## 5.3 Inference Abstraction Layer (IAL)

### 5.3.1 Interface

```typescript
export interface AgentBackend {
  readonly id: string;                         // "claude-agent-sdk" | "opencode" | ...
  capabilities(): BackendCapabilities;          // streaming text, tool events, interrupt, sessions
  openSession(ctx: SessionContext): Promise<AgentSession>;
}

export interface AgentSession {
  readonly sessionId: string;                   // backend-native id, persisted for resume
  send(input: AgentInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;                   // barge-in
  close(): Promise<void>;
}

export interface SessionContext {
  device: DeviceProfile;                        // capabilities, persona, locale
  tools: ToolSet;                               // avatar + device bridge + MCP servers
  permissionPolicy: PermissionPolicy;           // allow / deny / ask-on-device
  resumeSessionId?: string;
}

export type AgentInput =
  | { kind: "utterance"; text: string; heardSoFar?: string }   // heardSoFar = truncated previous answer
  | { kind: "event"; name: string; data: unknown };             // e.g. timer fired, device picked up

export type AgentEvent =
  | { type: "status"; phase: "thinking" | "responding" }
  | { type: "text.delta"; text: string }
  | { type: "tool.start"; name: string; input?: unknown }
  | { type: "tool.end"; name: string; ok: boolean }
  | { type: "permission.request"; id: string; tool: string; summary: string }
  | { type: "done"; usage?: Usage }
  | { type: "error"; message: string; retryable: boolean };
```

The orchestrator only consumes `AgentEvent`s; backends map their native streams onto this vocabulary.

### 5.3.2 Claude Agent SDK backend

| Aspect | Mapping |
| --- | --- |
| Package | `@anthropic-ai/claude-agent-sdk` (TypeScript) |
| Invocation | `query({ prompt: AsyncIterable<SDKUserMessage>, options })` — streaming-input mode keeps one long-lived query per device session; each utterance is pushed as a new user message |
| Streaming | `includePartialMessages: true` → partial assistant messages / stream events → `text.delta` |
| Tool events | Assistant `tool_use` content blocks → `tool.start`; tool results → `tool.end` |
| Interrupt | `Query.interrupt()` on barge-in |
| Sessions | `resume: <sessionId>` on reconnect; `forkSession` for experiments |
| System prompt | `systemPrompt: { type: "preset", preset: "claude_code", append: <persona + voice style rules> }` or a fully custom prompt (preferred for a companion persona) |
| Tools | `allowedTools` e.g. `WebSearch`, `WebFetch`, selected MCP tools; `disallowedTools` for `Bash`/`Write` unless explicitly enabled per profile |
| Custom tools | `createSdkMcpServer({ name: "avatar", tools: [tool("express", ...)] })` and `createSdkMcpServer({ name: "device", tools: [...] })` generated from the device's `hello.tools` |
| Permissions | `canUseTool(request)` → policy check → optionally `confirm.request` to device, resolve on `confirm.result` |
| Working directory | Per-device sandbox directory (`cwd`) for file-producing tools |
| Settings | `settingSources: []` to avoid loading the host user's Claude Code settings implicitly |
| Model | Configurable per profile (e.g. `claude-sonnet-5-5` for quality, `claude-haiku-4-5` for latency) |
| Auth | `ANTHROPIC_API_KEY` if set; otherwise the host's logged-in Claude subscription (personal use only — Anthropic does not permit offering claude.ai login in third-party products) |
| Latency | `startup()` / `prewarm()` to keep a warm process per active device |

### 5.3.3 OpenCode SDK backend

| Aspect | Mapping |
| --- | --- |
| Package | `@opencode-ai/sdk` |
| Server | `createOpencode()` (spawns `opencode serve`) or `createOpencodeClient({ baseUrl })` for a sidecar |
| Session | `client.session.create({ body: { title } })`, id persisted |
| Prompt | `client.session.prompt({ path: { id }, body: { parts: [{ type: "text", text }], model: { providerID, modelID }, agent?, system? } })` |
| Streaming | `client.event.subscribe()` SSE stream — `message.part.updated` (text / tool parts) → `text.delta` / `tool.*`; `session.idle` → `done` |
| Interrupt | `client.session.abort({ path: { id } })` |
| Permissions | permission events → `permission.request`; reply via the session permission endpoint |
| Tools / MCP | OpenCode config (`opencode.json`) declares MCP servers; the avatar and device tools are exposed by the Homunculus server as a local **streamable-HTTP MCP endpoint** (`/mcp/{deviceId}`) since OpenCode runs out-of-process |
| Providers | Any OpenCode provider (Anthropic, OpenAI, local via Ollama/LM Studio, …) — enables local-only operation |

### 5.3.4 Backend selection

Per device profile (`backend: "claude-agent-sdk" | "opencode"`), switchable at runtime (applies to next session). A voice command ("switch to OpenCode") can be implemented as a server-side meta-tool.

## 5.4 Speech pipeline

### 5.4.1 Speech-in

```mermaid
flowchart LR
    OP["Opus 16 kHz frames"] --> DEC["Opus decode"] --> PCM["PCM16 16 kHz"]
    PCM --> VAD["Silero VAD<br/>endpointing 500-700 ms"]
    PCM --> STT["Streaming STT"]
    VAD -- "end of speech" --> ORCH["Orchestrator"]
    STT -- "partials / final" --> ORCH
```

```typescript
export interface SttProvider {
  open(opts: { language?: string; sampleRate: 16000 }): SttStream;
}
export interface SttStream {
  write(pcm: Int16Array): void;
  end(): void;
  results(): AsyncIterable<{ text: string; final: boolean }>;
}
```

| Candidate | Type | Notes |
| --- | --- | --- |
| faster-whisper (large-v3-turbo) | Local (GPU recommended) | High accuracy, multilingual; pseudo-streaming via chunked decoding |
| NVIDIA Parakeet / Canary | Local (GPU) | Very low latency; strong English, growing multilingual |
| whisper.cpp | Local (CPU/Metal) | Good for CPU-only hosts with small/turbo models |
| Deepgram / AssemblyAI / ElevenLabs Scribe | Cloud streaming | Lowest effort, true streaming, endpointing built in |
| OpenAI transcription API | Cloud | Simple, batch or streaming |

Initial selection (D-01): whisper.cpp on CPU, English. faster-whisper on a GPU host later.

### 5.4.2 Speech-out

```mermaid
flowchart LR
    AG["text.delta stream"] --> SH["Speech Shaper"]
    SH --> SEG["Sentence segmenter"]
    SEG --> TTS["Streaming TTS"]
    TTS --> RS["Resample to device rate"] --> ENC["Opus encode 60 ms"] --> PACE["Real-time pacer"] --> GW["Gateway"]
    TTS --> ENV["Viseme / envelope extractor<br/>(optional)"] --> GW
```

Speech Shaper rules (applied to agent output before TTS):

1. The agent is instructed (system prompt) to answer conversationally and briefly, no markdown, no lists unless asked, numbers spelled for speech.
2. Defensive post-processing: strip markdown syntax, code blocks (replaced by "I've put the code on the server"), URLs (replaced by domain names), emoji.
3. Segment on sentence boundaries; first segment emitted early (≥ 1 clause, ≤ ~ 12 words) to minimise time-to-first-audio.
4. Long answers: speak a summary; full text is available as captions/history.

```typescript
export interface TtsProvider {
  synthesize(text: string, opts: { voice: string; sampleRate: number; signal: AbortSignal }): AsyncIterable<Int16Array>;
}
```

| Candidate | Type | Notes |
| --- | --- | --- |
| Kokoro (82M) | Local | High quality for size, runs on CPU, several voices/languages |
| Piper | Local | Very fast on CPU (incl. Raspberry Pi), many languages, more robotic |
| ElevenLabs / Cartesia | Cloud streaming | Lowest latency + most expressive; paid |
| OpenAI TTS | Cloud | Simple, streaming, steerable voice style |

Provider selection is configuration-driven; a profile may combine local STT with cloud TTS, etc.

Initial selection (D-02): Kokoro with a British female voice, English; Piper as fallback.

### 5.4.3 Persona

A persona is a configuration record, not code (D-04). It holds the name, personality / system-prompt text, TTS provider and voice, language, default emotional range for the avatar, and the wake word. The server loads persona definitions from configuration and each device profile references one. Only the wake word lives on the device (as a WakeNet model), so changing it requires a device-side model change.

The initial and only persona is **Claudia**: female, British voice, dark British humour.

## 5.5 Latency budget (target, simple question)

| Stage | Budget |
| --- | --- |
| End-of-speech detection (VAD hangover) | 500 ms |
| Final STT result after endpoint | 150–300 ms |
| Agent time-to-first-token (warm session) | 400–800 ms |
| First sentence complete + TTS first chunk | 200–300 ms |
| Network + device jitter buffer | 120–200 ms |
| **Total to first audio** | **≈ 1.4–2.1 s** |

Mitigations: prewarmed agent processes, speculative STT finalisation, early first segment, "acknowledgement" emote/earcon immediately at endpoint so perceived latency is near zero, filler phrase ("Let me check…") emitted by the orchestrator when a tool call starts and no speech has been produced for > 1.5 s.

## 5.6 Tool Hub

| Tool source | Implementation | Exposure to backend |
| --- | --- | --- |
| Avatar | In-process: `avatar.express(emote, intensity?, duration_ms?)`, `avatar.gesture(name)` | Claude: in-process SDK MCP server; OpenCode: local HTTP MCP endpoint |
| Device bridge | Generated from `hello.tools`; calls forwarded as `tool.call` over HDP, awaiting `tool.result` (timeout 5 s) | as above |
| Built-ins | Claude: `WebSearch`, `WebFetch`, etc.; OpenCode: its built-in tools | backend-native |
| External MCP | Configured per profile (e.g. calendar, home automation, notes, memory) | backend-native MCP config |
| Server meta-tools | `homunculus.remember`, `homunculus.set_timer`, `homunculus.switch_backend` | as avatar |

### Permission policy

| Class | Examples | Default |
| --- | --- | --- |
| Safe read | web search/fetch, device status, avatar | allow |
| Device actuation | volume, brightness, show text | allow |
| External side effects | send message, create calendar event, home automation | **ask on device** (`confirm.request`) |
| Host access | shell, file write | deny (opt-in per profile, sandboxed `cwd`) |

## 5.7 Persistence

SQLite tables: `devices` (id, model, token hash, profile id, last seen), `profiles` (persona, voice, language, backend, model, tool policy), `sessions` (device id, backend, backend session id, created, last turn), `turns` (transcript, response text, heard-so-far, latency metrics, tool calls). Conversation content itself is owned by the backend session store (Claude SDK session files / OpenCode storage); Homunculus stores only what it needs for resume, captions and metrics.

## 5.8 Observability

- Structured logs per turn with timestamps for every pipeline stage (enables latency budget tracking).
- Metrics (Prometheus): turn latency histogram per stage, STT/TTS errors, active devices, backend token usage.
- Debug mode: record uplink/downlink audio per turn (opt-in, privacy).

## 5.9 Admin interface

CLI + minimal web UI: pair devices (confirm pairing code), edit profiles, select backend/model/voice, view turn history and latency, push OTA.
