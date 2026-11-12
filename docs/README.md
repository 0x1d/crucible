---
id: crucible
title: Crucible
type: manifest
owner: crucible
profile: system
status: draft
summary: Monorepo that unifies alchemist, homunculus and nshde around shared packages
code: .
depends: []
documents: [crucible/requirements, crucible/architecture, crucible/decisions, crucible/open-items, crucible/framework]
date: 2026-11-11
---

# Crucible

Crucible is the monorepo that unifies three projects: **alchemist** (agent harness and codex runtime), **homunculus** (voice companion on ESP32 devices) and **nshde** (self-extending IDE).

Draft 0.1, 2026-11-10. Describes the **target** architecture; nothing in it is implemented yet unless a section says so.

This folder holds only what spans projects. Each project documents its own components in `projects/<project>/docs/`, following the [specification framework](framework.md).

| Document | Content |
| --- | --- |
| [framework.md](framework.md) | Specification framework: profiles, document types, templates, workflow |
| [requirements.md](requirements.md) | Purpose, scope, the three projects today, goals, constraints, terminology |
| [architecture.md](architecture.md) | System architecture: building blocks, shared packages, integration, repository layout |
| [decisions.md](decisions.md) | Decisions `crucible/AD-NN` |
| [open-items.md](open-items.md) | Open items `crucible/OI-NN` |
| [Planned work](architecture/repository-and-migration.md) | Dependency graph of the planned changes (section 6) |

| Project | Documentation |
| --- | --- |
| alchemist | [0x1d/alchemist docs](https://github.com/0x1d/alchemist/tree/main/docs) -> `projects/alchemist/docs/` *(to be moved and restructured)* |
| homunculus | [0x1d/homunculus docs](https://github.com/0x1d/homunculus/tree/main/docs) -> `projects/homunculus/docs/` *(to be moved and restructured)* |
| nshde | [0x1d/nshde docs](https://github.com/0x1d/nshde/tree/main/docs) -> `projects/nshde/docs/` *(to be moved)* |
| shared packages | `packages/<name>/docs/` *(to be written)* |

## Documentation conventions

| Rule | Value |
| --- | --- |
| Style | Descriptive: what exists, what it does, its contract. No task lists, no dated plan files |
| Document header | Front matter: id, title, type, owner, status, date, and every relation to other documents (`depends`, `related`, `planned`) ([framework](framework.md#front-matter)) |
| File names | One document per type (`architecture.md`); its sub-documents in the folder of the same name (`architecture/integration.md`) ([framework](framework.md#titles-and-file-names)) |
| Ids | Always fully qualified. A document's id is its path: `crucible/architecture/integration`, `crucible/homunculus/server/interfaces/http-api`. Items: `crucible/AD-08` ([framework](framework.md#identifiers)) |
| Decisions | `crucible/AD-NN` in [decisions.md](decisions.md), with status, rationale and alternatives |
| Open items | `crucible/OI-NN` in [open-items.md](open-items.md), each with a next step; closed by a decision |
| Planned work | A section marked **Planned** in the document that will describe it once built, declared with its dependencies in the document's front matter ([planned work](framework.md#planned-work)) |
| Diagrams | Mermaid |
| Replaces | `alchemist/docs/internal/{plans,specs}`, `nshde/docs/internal/plans` (see [crucible/architecture/repository-and-migration](architecture/repository-and-migration.md) section 5) |
