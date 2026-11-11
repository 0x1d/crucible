---
id: crucible/INDEX
title: Crucible Documentation
type: index
owner: crucible
date: 2026-11-11
---

# Crucible Documentation

Crucible is the monorepo that unifies three projects: **alchemist** (agent harness and codex runtime), **homunculus** (voice companion on ESP32 devices) and **nshde** (self-extending IDE).

Draft 0.1, 2026-11-10. Describes the **target** architecture; nothing in it is implemented yet unless a section says so.

This folder holds only what spans projects. Each project documents its own components in `projects/<project>/docs/`, following the [specification framework](framework/README.md).

| Section | Content |
| --- | --- |
| [framework/](framework/README.md) | Specification framework: profiles, document types, templates, workflow |
| [architecture/](architecture/README.md) | System architecture: goals, building blocks, shared packages, integration, repository layout, decisions, open items |
| [Planned work](architecture/ARCH-repository-and-migration.md) | Dependency graph of the planned changes (section 6) |

| Project | Documentation |
| --- | --- |
| alchemist | [alchemist/docs/](../alchemist/docs/index.md) -> `projects/alchemist/docs/` *(to be moved and restructured)* |
| homunculus | [homunculus/docs/](../homunculus/docs/README.md) -> `projects/homunculus/docs/` *(to be moved and restructured)* |
| nshde | `projects/nshde/docs/` *(to be written)* |
| shared packages | `packages/<name>/docs/` *(to be written)* |

## Documentation conventions

| Rule | Value |
| --- | --- |
| Style | Descriptive: what exists, what it does, its contract. No task lists, no dated plan files |
| Document header | Front matter: id, title, type, owner, status, date, and every relation to other documents (`depends`, `related`, `planned`) ([framework](framework/README.md#front-matter)) |
| File names | `<CODE>-<title slug>.md`, e.g. `ARCH-integration.md` ([framework](framework/README.md#titles-and-file-names)) |
| Ids | Always fully qualified: `crucible/ARCH-integration`, `crucible/AD-08`, `crucible/homunculus/server/IFC-http-api` ([framework](framework/README.md#identifiers)) |
| Decisions | `crucible/AD-NN` in [architecture/AD-decisions.md](architecture/AD-decisions.md), with status, rationale and alternatives |
| Open items | `crucible/OI-NN` in [architecture/OI-open-items.md](architecture/OI-open-items.md), each with a next step; closed by a decision |
| Planned work | A section marked **Planned** in the document that will describe it once built, declared with its dependencies in the document's front matter ([planned work](framework/README.md#planned-work)) |
| Diagrams | Mermaid |
| Replaces | `alchemist/docs/internal/{plans,specs}`, `nshde/docs/internal/plans` (see [crucible/ARCH-repository-and-migration](architecture/ARCH-repository-and-migration.md) section 5) |
