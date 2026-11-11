---
id: crucible/homunculus
title: Homunculus
type: index
owner: crucible
date: 2026-11-11
---

# Homunculus

Homunculus is a physical AI companion running on ESP32 devices: an animated avatar that listens, thinks and talks, backed by a server-side agent harness (Claude Agent SDK, OpenCode SDK) with tools and internet access.

The documents follow the [Crucible specification framework](https://github.com/0x1d/crucible/blob/main/docs/framework.md). Every document has a fully qualified id that equals its path under `docs/`, prefixed with `crucible/homunculus`.

| Component | Profile | Summary |
| --- | --- | --- |
| [crucible/homunculus/firmware](firmware/README.md) | device | ESP-IDF firmware: audio, wake word, avatar, device tools, HDP client |
| [crucible/homunculus/server](server/README.md) | service | Gateway, orchestrator, speech pipeline, agent backends, tools, memory |
| [crucible/homunculus/hdp](hdp/README.md) | protocol | Device protocol between firmware and server |

| Project document | Content |
| --- | --- |
| [crucible/homunculus/requirements](requirements.md) | Vision, scope, goals, functional and non-functional requirements, terminology |
| [crucible/homunculus/architecture](architecture.md) | Context, responsibility split, containers, turn and barge-in sequences, deployment; phases, risks and research notes as sub-documents |
| [crucible/homunculus/security](security.md) | Threat model, privacy principles, authentication |
| [crucible/homunculus/development](development.md) | Nix development shells, checks, flashing, Git LFS |
| [crucible/homunculus/decisions](decisions.md) | Decisions `crucible/homunculus/D-NN` |
| [crucible/homunculus/open-items](open-items.md) | Open items `crucible/homunculus/OI-NN` |

Item ids predate the framework and are kept: `FR-NN`, `NFR-NN` (operational requirements), `AD-NN`, `D-NN` (product decisions), `OI-NN`, `R-NN` (risks).
