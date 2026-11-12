---
id: crucible/architecture/shared-packages
title: Shared Packages
type: ARCH
owner: crucible
status: Draft
date: 2026-11-10
depends: [crucible/architecture/system-architecture]
related: []
---

# Shared Packages

Interfaces below are architectural sketches. The binding contract of each package is its `IFC` (`packages/<name>/docs/interfaces.md`).

## 1 `packages/memory`

### 1.1 Responsibility

A generic memory interface with swappable providers. The generic part is `recall` / `retain` / `forget`; it does not assume a fact graph, Datalog or bi-temporal time, so that a provider such as Hindsight (retain / recall / reflect) fits.

### 1.2 Interface

```typescript
export interface MemoryProvider {
  readonly id: string;                         // "minigraf" | "hindsight" | ...
  capabilities(): { facts: boolean; temporal: boolean; extraction: boolean };
  open(space: string, deps: { sample?: Sampler }): Promise<MemorySpace>;
}

export interface MemorySpace {
  /** Before a turn: context relevant to the query. */
  recall(query: string, opts?: { limit?: number; at?: string }): Promise<MemoryItem[]>;
  /** After a turn (exchange -> provider extracts) or explicitly (items). */
  retain(
    input: { exchange: string } | { items: MemoryItem[] },
    meta?: { session?: string; reason?: string },
  ): Promise<RetainResult>;
  forget(ref: string, mode: "close" | "erase"): Promise<void>;
  /** Provider-native agent tools (minigraf: query / transact / retract; Hindsight: reflect). */
  tools(): HostTool[];
  /** Provider's usage rules for the system prompt. */
  promptSection(): string;
  close(): Promise<void>;
}

/** Answers a provider's extraction prompt with model text. */
export type Sampler = (prompt: string, maxTokens: number) => Promise<string>;
```

| Rule | Statement |
| --- | --- |
| Hosts | Use only `recall`, `retain`, `forget`, `tools()`, `promptSection()`. They never name a provider |
| Provider-specific power | Reaches the agent through `tools()` and `promptSection()` only |
| Extraction model | Injected as `Sampler`; the package has no LLM dependency |
| Selection | Provider id and space name come from application configuration |

### 1.3 Minigraf provider

| Item | Value |
| --- | --- |
| Engine | `minigraf` npm binding (alchemist's current implementation) |
| Capabilities | `facts`, `temporal`; `extraction` once prepare / finalize are ported (crucible/OI-03) |
| Native tools | Pattern / Datalog query, transact, retract (`close` / `correct`), overview, rules |
| Schema profiles | Entity namespaces shared (`decision`, `preference`, `constraint`, `dependency`); attribute set per profile |
| Profile `engineering` | `description`, `rationale`, `depends-on`, `motivated-by`, `governs`, `supersedes`, `source-session` (alchemist today) |
| Profile `personal` | `description`, `rationale`, `alias`, `date`, `entity-type` incl. `type/person`, `type/place` (homunculus today) |
| Interim | Homunculus's temporal-reasoning MCP client stays available as a second provider until `recall` / `retain`-by-exchange exist natively |

### 1.4 Entry points and ownership

| Entry point | Consumer |
| --- | --- |
| TypeScript library | homunculus server, `agent` |
| stdio line-JSON server | alchemist `Runtime.Memory` (the protocol it already speaks) |

Each application opens its own store: alchemist one graph with the `engineering` profile; homunculus one space per device profile with the `personal` profile. No store is shared (crucible/AD-05), so crucible/C-02 is met without a memory service.

### 1.5 Codex entries

| Entry | Maps to | Available |
| --- | --- | --- |
| `memory.remember` | `retain({ items })` | always |
| `memory.overview`, `memory.recall` | `recall` | always |
| `memory.query`, `memory.transact`, `memory.retract` | provider tools | when `capabilities().facts` |

### 1.6 Wiki

Homunculus's wiki (Markdown pages, BM25 search, git commit per change) moves into the package as an optional second store beside the provider (crucible/OI-07).

## 2 `packages/agent`

### 2.1 Responsibility

One abstraction over agent harnesses, taken from homunculus's inference abstraction layer. Front-ends (voice, HTTP/SSE, terminal) drive an `AgentSession` and consume `AgentEvent`s.

### 2.2 Interface

```typescript
export interface AgentBackend {
  readonly id: string;                          // "claude-agent-sdk" | "acp" | ...
  capabilities(): BackendCapabilities;           // streaming text, tool events, interrupt, sessions
  openSession(ctx: SessionContext): Promise<AgentSession>;
}

export interface AgentSession {
  readonly sessionId: string | undefined;        // backend-native, persisted for resume
  send(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface SessionContext {
  systemPrompt: string;
  resumeSessionId?: string;
  cwd?: string;
  servers?: Record<string, HostTool[]>;          // tool servers by name: codex, memory, device, ...
  confirm?: (req: ConfirmRequest, signal?: AbortSignal) => Promise<boolean>;
  memory?: MemorySpace;                          // recall before / retain after a turn
  policies?: ContextPolicy[];                    // see 3.2.4
}

export interface HostTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;          // JSON Schema
  policy: "allow" | "ask";
  call(args: unknown, signal?: AbortSignal): Promise<ToolOutcome>;
}
```

`AgentInput` (`utterance` with optional `heardSoFar` and `context`, or `event`) and `AgentEvent` (`status`, `text.delta`, `tool.start`, `tool.end`, `permission.request`, `done`, `error`) keep the homunculus definitions (HOM-SPEC-05 section 5.3.1).

### 2.3 Backends

| Backend | Source | Status |
| --- | --- | --- |
| Claude Agent SDK | homunculus `inference/claude/backend.ts`, merged with alchemist `hosts/claude/codex.ts` options | Exists in both projects |
| ACP | alchemist `hosts/acp` | Exists; to be adapted to `AgentBackend`. Candidate replacement for homunculus's deferred OpenCode backend (crucible/OI-09) |
| Cursor | - | Not a backend (crucible/C-06); the Cursor host stays an alchemist host |

### 2.4 Context policies

Host-side rules that today live in `alchemist/hosts/cursor/bot/lib` and are imported across hosts:

| Policy | Function |
| --- | --- |
| Host flags | Per-host settings and state root |
| History reclaim | Autocompact or handoff-and-fork |
| Result digest, result cap | Bound the size of tool results in context |
| Explore gate, recall-before-explore | Route to memory before exploring |
| Auto-retain | `retain` every *n* turns |

### 2.5 Front-ends

| Front-end | Application | Built on |
| --- | --- | --- |
| Voice orchestrator | homunculus | `AgentSession`, long-lived, `interrupt` on barge-in |
| HTTP / SSE sidecar | alchemist (for athanor) | `AgentSession`; maps `AgentEvent` to the sidecar's SSE events |
| TUI | alchemist | `AgentSession` |

## 3 `packages/codex-client`

| Part | Content |
| --- | --- |
| Bridge | Starts or reuses the long-lived BEAM, compiles `runtime/` when needed, framed TCP RPC |
| Protocol | `CodexRequest` types, tool names for the four operations |
| Codex tool server | The four operations as `HostTool[]`, ready for `SessionContext.servers` |
| CLI | `scripts/cli.mjs` equivalent |

The bridge currently imports a type from `@grok/agent-sdk`; the package removes that dependency.

## 4 `packages/storage`

### 4.1 Interface

```typescript
export interface StorageProvider {
  readonly id: string;                                   // "fs" | "memory" | "s3" | "supabase"
  list(prefix?: string): Promise<StorageObject[]>;
  tree(prefix?: string): Promise<StorageObject[]>;
  stat(path: string): Promise<StorageObject | undefined>; // incl. content hash
  read(path: string): Promise<string | Uint8Array>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
```

Extends athanor's existing `StorageProvider` with `tree`, `stat` and a content hash.

### 4.2 Mounts

| Item | Value |
| --- | --- |
| Path form | `<mount>:<relative path>`, e.g. `workspace:components/todo.nsh.tsx` |
| Mount table | Configuration: mount name -> provider + root |
| Typical mounts | `workspace:` (athanor's store), `local:` (a directory on the host), per-device sandbox mounts in homunculus |
| Boundary | A path outside every configured mount is refused |

### 4.3 Access from the BEAM

| Part | Content |
| --- | --- |
| `AgentLib.Storage` | Elixir behaviour in the codex entry SDK: `read`, `write`, `list`, `stat`, `delete` |
| `Local` adapter | `File.*` under the mount root |
| `Remote` adapter | HTTP to the storage API of the process that owns the provider (athanor API today) |
| `fs.*` entries | Resolve the mount, call `AgentLib.Storage`. `nshde.component.read / list / write` reduce to `fs.*` plus the compile check |
| Limit | `git.*`, `fs.rg` and other entries that shell out work only on mounts backed by local disk and return an error otherwise |

## 5 Codex entry SDK (Elixir)

| Part | Content |
| --- | --- |
| `AgentFn.Tool` | Behaviour declaring `run/1` |
| `AgentFn.Codex` | List entries, dynamic dispatch |
| `Runtime.Result` | Result envelope |
| `AgentLib.Storage` | Storage behaviour and adapters (section 4.3) |
| Test helper | `functions/test_helper.exs` |

A Mix package in the monorepo. The codex repository depends on it as a git dependency, which pins the contract version the library is built against.

## 6 Not extracted

| Candidate | Reason |
| --- | --- |
| HDP protocol (`homunculus/protocol`) | One consumer |
| Speech (STT, TTS, VAD, shaper) | One consumer; already behind interfaces, extract when athanor or the TUI gets voice |
| `AgentLib.Strings`, `AgentLib.Nshde` | 95 lines; move with the entries that use them |
| Service tokens, service gateway client | athanor-specific |
