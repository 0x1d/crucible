---
id: crucible/homunculus/server
title: Server
type: manifest
owner: crucible/homunculus
profile: service
status: active
summary: TypeScript server: gateway, orchestrator, speech pipeline, agent backends, tools and memory
code: server
depends: [crucible/homunculus/hdp]
implements: [crucible/homunculus/hdp/interfaces/device-protocol]
documents: [crucible/homunculus/server/design]
date: 2026-11-11
---

# Server

The Homunculus server. It terminates HDP, runs speech-in and speech-out, drives the agent backend and exposes tools and long-term memory to it.

| Document | Title |
| --- | --- |
| [crucible/homunculus/server/design](design.md) | Design, with a sub-document for long-term memory |

Not written yet (crucible/homunculus/OI-18): requirements, architecture, interfaces, security, operations, verification. Until then the project documents cover them: [crucible/homunculus/requirements](../requirements.md), [crucible/homunculus/architecture](../architecture.md), [crucible/homunculus/security](../security.md).

## Dependencies

| Component | Uses | Interface |
| --- | --- | --- |
| crucible/homunculus/hdp | Connection to the devices; the server implements the server side | [crucible/homunculus/hdp/interfaces/device-protocol](../hdp/interfaces/device-protocol.md) |
