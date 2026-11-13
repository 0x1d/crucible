---
id: crucible
title: Crucible
type: manifest
owner: crucible
standard: formulary/0.2
profile: system
status: draft
summary: Monorepo that unifies alchemist, homunculus and athanor around shared packages
code: .
depends: []
documents: [crucible/requirements, crucible/architecture, crucible/development, crucible/increments, crucible/decisions, crucible/open-items]
date: 2026-11-13
---

# Crucible

Crucible is the monorepo that unifies three projects: **alchemist** (agent harness and codex runtime), **homunculus** (voice companion on ESP32 devices) and **athanor** (self-extending IDE).

Draft 0.1, 2026-11-10. Describes the **target** architecture; nothing in it is implemented yet unless a section says so.

This folder holds only what spans projects. Each project documents its own components in `projects/<project>/docs/`, following the [Formulary standard](https://github.com/0x1d/formulary).

| Document | Content |
| --- | --- |
| [requirements.md](requirements.md) | Purpose, scope, the three projects today, goals, constraints, terminology |
| [architecture.md](architecture.md) | System architecture: building blocks, shared packages, integration, repository layout |
| [development.md](development.md) | Dev shells, workspace commands, CI, conventions |
| [increments.md](increments.md) | Product increments and their planned work |
| [decisions.md](decisions.md) | Decisions `crucible/AD-NN` |
| [open-items.md](open-items.md) | Open items `crucible/OI-NN` |

| Project | Documentation |
| --- | --- |
| alchemist | [crucible/alchemist](../projects/alchemist/docs/README.md) |
| homunculus | [crucible/homunculus](../projects/homunculus/docs/README.md) |
| athanor | [crucible/athanor](../projects/athanor/docs/README.md) |
| codex-client (package) | [crucible/packages/codex-client](../packages/codex-client/docs/README.md) |
| memory (package) | [crucible/packages/memory](../packages/memory/docs/README.md) |

## Documentation conventions

| Rule | Value |
| --- | --- |
| Standard | The documents conform to [Formulary](https://github.com/0x1d/formulary) 0.2. Its rules and templates are not copied here |
| Style | Descriptive: what exists, what it does, its contract. No task lists, no dated plan files |
| Document header | Front matter: id, title, type, owner, status, date, and every relation to other documents (`depends`, `related`, `planned`) ([Formulary](https://github.com/0x1d/formulary#front-matter)) |
| File names | One document per type (`architecture.md`); its sub-documents in the folder of the same name (`architecture/integration.md`) ([Formulary](https://github.com/0x1d/formulary#titles-and-file-names)) |
| Ids | Always fully qualified. A document's id is its path: `crucible/architecture/integration`, `crucible/homunculus/server/interfaces/http-api`. Items: `crucible/AD-08` ([Formulary](https://github.com/0x1d/formulary#identifiers)) |
| Decisions | `crucible/AD-NN` in [decisions.md](decisions.md), with status, rationale and alternatives |
| Open items | `crucible/OI-NN` in [open-items.md](open-items.md), each with a next step; closed by a decision |
| Planned work | A section marked **Planned** in the document that will describe it once built, declared with its dependencies in the document's front matter ([Formulary](https://github.com/0x1d/formulary#planned-work)). Changes that span projects are grouped into product increments in [increments.md](increments.md) |
| Diagrams | Mermaid |
| No plan files | Dated plan and specification files are not kept; the earlier ones were folded into the component documents ([crucible/architecture/repository-layout](architecture/repository-layout.md) section 2) |
