---
id: crucible/architecture/shared-packages
title: Shared Packages
type: ARCH
owner: crucible
status: Draft
date: 2026-11-13
depends: [crucible/architecture/system-architecture]
related: [crucible/packages/codex-client, crucible/packages/memory]
planned: []
---

# Shared Packages

This document names the shared packages and what each is responsible for. The binding contract of a package is its `IFC` (`packages/<name>/docs/interfaces.md`). `codex-client` and `memory` are specified there; the interfaces of `agent` and `storage` below are architectural sketches until their packages are specified.

## 1 `packages/memory`

Specified in [crucible/packages/memory](../../packages/memory/docs/README.md); the binding contract is [crucible/packages/memory/interfaces](../../packages/memory/docs/interfaces.md).

| Part | Responsibility |
| --- | --- |
| Memory interface | `recall`, `retain`, `forget`, provider tools and a prompt section. It does not assume a fact graph, Datalog or bi-temporal time, so that a provider such as Hindsight fits (crucible/AD-03, crucible/AD-09) |
| Minigraf provider | The first provider (crucible/AD-04), built on the `minigraf` npm binding, with the schema profiles `engineering` and `personal` (crucible/AD-11) |
| Line server | The provider behind a stdio process, for a consumer that is not TypeScript: alchemist's `Runtime.Memory` |

| Rule | Statement |
| --- | --- |
| Hosts | Use only the memory interface. They never name a provider; the provider id and the space name come from application configuration |
| Provider-specific power | Reaches the agent through the provider's tools and prompt section only |
| Extraction model | Injected by the application; the package has no LLM dependency |
| Ownership | Each application opens its own store: alchemist one graph with the `engineering` profile, homunculus one graph per memory space with the `personal` profile. No store is shared (crucible/AD-05), so crucible/C-02 is met without a memory service |
| Wiki | Not part of the package; it stays in homunculus (crucible/AD-26) |

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
  policies?: ContextPolicy[];                    // see 2.4
}

export interface HostTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;          // JSON Schema
  policy: "allow" | "ask";
  call(args: unknown, signal?: AbortSignal): Promise<ToolOutcome>;
}
```

`AgentInput` (`utterance` with optional `heardSoFar` and `context`, or `event`) and `AgentEvent` (`status`, `text.delta`, `tool.start`, `tool.end`, `permission.request`, `done`, `error`) keep the homunculus definitions ([crucible/homunculus/server/design](../../projects/homunculus/docs/server/design.md)).

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

Specified in [crucible/packages/codex-client](../../packages/codex-client/docs/README.md); the binding contract is [crucible/packages/codex-client/interfaces](../../packages/codex-client/docs/interfaces.md).

| Part | Responsibility |
| --- | --- |
| Client | Starts or reuses the long-lived BEAM, compiles `runtime/` when needed, sends codex requests over framed TCP |
| Protocol types | The request and result types and the tool names of the four operations |
| Codex tool set | The four operations as tools, ready for `SessionContext.servers` |
| Command line | The `codex` command: one request per invocation |

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
