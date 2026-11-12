---
id: crucible/alchemist/runtime
title: Runtime
type: manifest
owner: crucible/alchemist
profile: service
status: active
summary: Long-lived BEAM runtime that holds the codex and memory and serves define, load, find and call
code: runtime
depends: [crucible/alchemist/codex-protocol]
implements: [crucible/alchemist/codex-protocol/interfaces/codex-protocol]
documents: [crucible/alchemist/runtime/design]
date: 2026-11-11
---

# Runtime

The long-lived Elixir runtime. It compiles and loads codex entries, runs calls, and owns the MiniGraf memory. Working notes for contributors are in `runtime/README.md` in the code.

| Document | Title |
| --- | --- |
| [crucible/alchemist/runtime/design](design.md) | Design, with a sub-document for memory |

Not written yet (crucible/alchemist/OI-01): requirements, architecture, operations, verification. Until then the project documents cover them: [crucible/alchemist/architecture](../architecture.md), [crucible/alchemist/security](../security.md).
