---
id: crucible/architecture
title: Architecture
type: ARCH
owner: crucible
status: Draft
date: 2026-11-11
depends: [crucible/requirements]
related: [crucible/decisions, crucible/open-items]
planned: []
---

# Crucible - Architecture

Crucible is one monorepo: three applications (alchemist, homunculus, nshde) built on a set of shared packages and talking to each other over defined channels. This document is the summary and index of the system architecture; each part is a sub-document, listed in reading order.

| Sub-document | Content |
| --- | --- |
| [crucible/architecture/system-architecture](architecture/system-architecture.md) | Context, building blocks, dependency rules, processes, current-to-target mapping |
| [crucible/architecture/shared-packages](architecture/shared-packages.md) | `memory`, `agent`, `codex-client`, `storage`, codex entry SDK: responsibilities and interfaces |
| [crucible/architecture/integration](architecture/integration.md) | How nshde, alchemist and homunculus talk to each other |
| [crucible/architecture/repository-and-migration](architecture/repository-and-migration.md) | Monorepo layout, codex repository, tooling, documentation migration, planned work |

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
