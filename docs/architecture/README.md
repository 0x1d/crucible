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
documents: [crucible/REQ, crucible/ARCH, crucible/ARCH-shared-packages, crucible/ARCH-integration, crucible/ARCH-repository-and-migration, crucible/AD, crucible/OI]
date: 2026-11-11
---

# Crucible - Architecture

System manifest (profile `system`). The documents are listed in reading order; the Type column repeats the `type` from each document's front matter.

| Id | Type | Document | Content |
| --- | --- | --- | --- |
| crucible/REQ | `REQ` | [Requirements](REQ-requirements.md) | Purpose, scope, the three projects today, goals, constraints, terminology |
| crucible/ARCH | `ARCH` | [Architecture](ARCH-architecture.md) | Context, building blocks, dependency rules, processes, current-to-target mapping |
| crucible/ARCH-shared-packages | `ARCH` | [Shared Packages](ARCH-shared-packages.md) | `memory`, `agent`, `codex-client`, `storage`, codex entry SDK: responsibilities and interfaces |
| crucible/ARCH-integration | `ARCH` | [Integration](ARCH-integration.md) | How nshde, alchemist and homunculus talk to each other |
| crucible/ARCH-repository-and-migration | `ARCH` | [Repository and Migration](ARCH-repository-and-migration.md) | Monorepo layout, codex repository, tooling, documentation migration, phases |
| crucible/AD | `AD` | [Decisions](AD-decisions.md) | Architectural decisions `crucible/AD-NN` |
| crucible/OI | `OI` | [Open Items](OI-open-items.md) | Open questions `crucible/OI-NN` and things not yet verified |

## Architecture at a glance

```mermaid
flowchart TB
    subgraph Apps["Applications"]
        NSH["nshde<br/>IDE + Bun API"]
        HOM["homunculus<br/>firmware + voice server"]
        ALC["alchemist<br/>BEAM runtime, TUI, Cursor host"]
    end
    subgraph Pkgs["Shared packages"]
        AG["agent<br/>backends, sessions, context policies"]
        MEM["memory<br/>provider interface, minigraf provider"]
        ST["storage<br/>provider interface, fs / memory / s3"]
        CC["codex-client<br/>bridge + protocol"]
        SDK["codex entry SDK (Elixir)"]
    end
    CODEX[("codex repository<br/>function library, components")]

    NSH --> AG & ST & CC
    HOM --> AG & MEM & CC
    ALC --> AG & MEM & CC & SDK
    ALC -. "loads entries" .-> CODEX
    CODEX -. "compiles against" .-> SDK
```
