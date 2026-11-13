---
id: crucible/alchemist/host-cursor
title: Cursor Host
type: manifest
owner: crucible/alchemist
profile: integration
status: active
summary: Host for the Cursor agent, with its bot instructions, context management and evals
code: hosts/cursor
depends: [crucible/alchemist/codex-protocol]
implements: []
documents: [crucible/alchemist/host-cursor/design, crucible/alchemist/host-cursor/decisions]
date: 2026-11-13
---

# Cursor Host

Host for the Cursor agent, with its bot instructions, context management and evals. Host adapters in general are described in [crucible/alchemist/architecture/host-adapters](../architecture/host-adapters.md).

| Document | Title |
| --- | --- |
| [crucible/alchemist/host-cursor/design](design.md) | Design: host flags, tool results, context budget, prompt cache, handoff, explore and memory |
| [crucible/alchemist/host-cursor/decisions](decisions.md) | Decisions |

Not written yet (crucible/alchemist/OI-01): requirements, interfaces (mapping), verification. Until then the project documents cover them: [crucible/alchemist/architecture](../architecture.md), [crucible/alchemist/security](../security.md).
