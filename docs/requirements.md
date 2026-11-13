---
id: crucible/requirements
title: Requirements
type: REQ
owner: crucible
status: Draft
date: 2026-11-10
depends: []
related: []
---

# Requirements

## 1 Purpose

Crucible unifies three projects that already depend on each other or duplicate each other's parts.
They become one git monorepo with shared packages for the duplicated parts and defined channels between the applications.

## 2 The projects today

| Project | What it is | Stack | Repository |
| --- | --- | --- | --- |
| alchemist | Host-independent agent harness. The **codex** is its capability layer: Elixir entries under `functions/`, served by a long-lived BEAM through four operations (`define`, `load`, `find`, `call`). Hosts: Cursor, Claude Agent SDK, ACP, athanor sidecar, TUI | Elixir, Node 24, npm | `0x1d/alchemist`, 142 commits |
| homunculus | Physical AI companion: ESP32 firmware (audio, avatar) and a server (gateway, orchestrator, speech, agent, memory) speaking HDP over WebSocket | ESP-IDF, Node >= 22, pnpm, Git LFS | `0x1d/homunculus`, 91 commits |
| athanor | Recursive IDE: an agent writes NSH components and backend services; the IDE hot-mounts them | Bun, React, NSH | `0x1d/athanor`, 39 commits |

Existing coupling: athanor uses the alchemist Claude host as its agent (sidecar, `nshde.component.*` entries, service gateway). Homunculus is not connected to either.

## 3 Overlap found in the review

| Area | alchemist | homunculus | athanor |
| --- | --- | --- | --- |
| Memory | `core/minigraf-memory.ts`: `minigraf` npm binding in a Node child owned by `Runtime.Memory`; JSON API `transact / retract / query / overview` | `server/src/memory/`: Python `temporal-reasoning` MCP child (same minigraf engine); raw Datalog tools, per-turn `prepare` / `finalize`, wiki | - |
| Agent | `hosts/claude/codex.ts`, `hosts/nshde/session.ts`: one SDK `query()` per turn, own `SessionEvent` stream; ACP host | `server/src/inference/`: `AgentBackend` / `AgentSession` / `AgentEvent`, long-lived session, interrupt, `allow` / `ask` tool policy | consumes the alchemist sidecar |
| Files | `fs.*` codex entries: `File.*` on the host disk, no root restriction; `nshde.component.*` over HTTP | per-device sandbox directories, wiki pages | `StorageProvider` with `fs`, `memory`, `s3` backends |
| Context handling | `hosts/cursor/bot/lib` (host flags, handoff, result digest, caps), imported by the Claude host, ACP host and TUI | - | - |

## 4 Goals and non-goals

| Goals | Non-goals |
| --- | --- |
| One monorepo with preserved history for all three projects | Rewriting any application |
| One implementation each for memory, agent sessions, storage access and codex access | Merging the applications into one process or product |
| Memory behind a generic interface; providers can be swapped (minigraf first) | Sharing one memory graph between applications |
| The codex function library in its own repository | Moving the codex runtime out of the monorepo |
| Defined channels between homunculus, alchemist and athanor | A general message bus |
| Architecture / specification / design documentation; no dated plan and spec files | Keeping the superpowers-style `plans/` and `specs/` records |

## 5 Constraints

| ID | Constraint |
| --- | --- |
| C-01 | `define` compiles and runs arbitrary Elixir with the privileges of the BEAM process |
| C-02 | A minigraf graph file has exactly one open handle (one owner process) |
| C-03 | athanor runs on Bun (`Bun.serve`); alchemist's CLI and hosts run on Node, never Bun |
| C-04 | Homunculus needs voice-to-first-audio <= 1.5 s p50 (crucible/homunculus/NFR-01); nothing on the turn path may block on long work |
| C-05 | Homunculus firmware needs the ESP-IDF toolchain; it must not be required for the other projects |
| C-06 | The Cursor host is built on `@grok/agent-sdk`, which is its own harness and deployment format |

## 6 Terminology

Project-specific terms keep their existing definitions (alchemist domain language, homunculus spec section 1.6). Crucible adds:

| Term | Meaning |
| --- | --- |
| Crucible | The monorepo and the combined system |
| Application | One of athanor, homunculus, alchemist: a deployable with its own processes |
| Shared package | A library under `packages/` used by at least two applications |
| Codex runtime | The `:runtime` OTP application on the long-lived BEAM (alchemist) |
| Codex repository | The separate git repository holding the function library and agent-written content |
| Kernel entries | Codex entries that stay in the monorepo because they are coupled to the runtime |
| Codex entry SDK | The Elixir contract entries compile against (`AgentFn.Tool`, `AgentFn.Codex`, `AgentLib.Storage`, test helper) |
| Memory provider | An implementation of the memory interface (minigraf; later others, e.g. Hindsight) |
| Memory space | One named, isolated memory store of one application |
| Mount | A named storage root (`workspace:`, `local:`) mapped to a storage backend |
| Front-end | Code that drives an agent session for one channel: voice, HTTP/SSE, terminal |
