---
id: crucible/athanor/ide
title: IDE
type: manifest
owner: crucible/athanor
profile: app
status: active
summary: The IDE shell: docks, editor, agent panel, explorer and runtime preview, built with NSH
code: .
depends: [crucible/athanor/api]
implements: []
documents: [crucible/athanor/ide/design]
date: 2026-11-11
---

# IDE

The IDE shell in the browser: NSH TSX (`App.tsx`, `src/client`, `src/nshde`). It talks to the API for storage, preview and agent turns.

| Document | Title |
| --- | --- |
| [crucible/athanor/ide/design](design.md) | Design, one sub-document per part of the shell |

Not written yet (crucible/athanor/OI-01): requirements, ux, verification.

## Dependencies

| Component | Uses | Interface |
| --- | --- | --- |
| crucible/athanor/api | Storage, preview sandbox, agent sessions | Not written yet (crucible/athanor/OI-01) |
