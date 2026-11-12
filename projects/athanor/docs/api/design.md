---
id: crucible/athanor/api/design
title: Design
type: DES
owner: crucible/athanor/api
status: Draft
date: 2026-11-11
depends: []
related: [crucible/athanor/ide/design]
planned: []
---

# Design

The API's design is recorded as sub-documents. Each specifies a planned change, declared in its front matter with its dependencies.

| Sub-document | Content | State |
| --- | --- | --- |
| [crucible/athanor/api/design/alchemist-integration](design/alchemist-integration.md) | The alchemist Claude host as the athanor agent: sidecar, component entries, service gateway and binding | All slices done, not closed |
| [crucible/athanor/api/design/free-tier-deployment](design/free-tier-deployment.md) | Vercel, Supabase and Koyeb free tiers, plus a GitHub repository for the agent's code | Planned |
| [crucible/athanor/api/design/access-control](design/access-control.md) | Supabase Auth in front of the API; the preview sandbox as the boundary for agent-written code | Planned |
| [crucible/athanor/api/design/agent-sandbox](design/agent-sandbox.md) | The agent on demand in a Vercel Sandbox | Planned |
