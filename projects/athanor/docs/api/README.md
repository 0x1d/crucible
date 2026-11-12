---
id: crucible/athanor/api
title: API
type: manifest
owner: crucible/athanor
profile: service
status: active
summary: The Bun server: /api routes for storage, the preview sandbox and the agent
code: src/server.ts
depends: []
implements: []
documents: [crucible/athanor/api/design]
date: 2026-11-11
---

# API

The Bun server (`src/server.ts`, `src/lib`). It exposes `/api/*`, serves the React sandbox at `/preview` and starts agent turns through the alchemist sidecar.

| Document | Title |
| --- | --- |
| [crucible/athanor/api/design](design.md) | Design: the alchemist integration and the planned access control, agent sandbox and deployment |

Not written yet (crucible/athanor/OI-01): requirements, architecture, interfaces, security, operations, verification.
