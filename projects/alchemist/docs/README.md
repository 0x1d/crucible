---
id: crucible/alchemist
title: Alchemist
type: index
owner: crucible
standard: formulary/0.2
date: 2026-11-11
---

# Alchemist

Alchemist is a host-independent agent harness. The codex is its capability layer: an Elixir source tree, its metadata, and the operations `define`, `load`, `find`, and `call`. Hosts share that layer. Memory and the long-lived runtime sit beside it.

The documents conform to the [Formulary standard](https://github.com/0x1d/formulary). Every document has a fully qualified id that equals its path under `docs/`, prefixed with `crucible/alchemist`.

| Component | Profile | Summary |
| --- | --- | --- |
| [crucible/alchemist/runtime](runtime/README.md) | service | BEAM runtime: codex, calls, memory |
| [crucible/alchemist/codex-protocol](codex-protocol/README.md) | protocol | The operations `define`, `load`, `find`, `call` |
| [crucible/alchemist/tui](tui/README.md) | app | Terminal UI for chatting with a host |
| [crucible/alchemist/host-claude](host-claude/README.md) | integration | Claude Agent SDK example host |
| [crucible/alchemist/host-acp](host-acp/README.md) | integration | Agent Client Protocol hosts |
| [crucible/alchemist/host-cursor](host-cursor/README.md) | integration | Cursor host |

| Project document | Content |
| --- | --- |
| [crucible/alchemist/architecture](architecture.md) | Component boundaries, request lifecycle, supervision, composition models; domain language, host adapters and the planned athanor deployment as sub-documents |
| [crucible/alchemist/security](security.md) | Trust model and arbitrary-code risks |
| [crucible/alchemist/development](development.md) | Nix shell and direnv development environment |
| [crucible/alchemist/open-items](open-items.md) | Open items `crucible/alchemist/OI-NN` |

| Guide | For |
| --- | --- |
| [Getting started](guides/getting-started.md) | Installing dependencies and making the first codex call |
| [Authoring codex entries](guides/authoring-entries.md) | Slugs, modules, codex operations, testing entries |
| [Terminal UI](guides/tui.md) | Running a host in the terminal |

Outside `docs/`: the [product overview](../README.md), the [repository-agent rules](../AGENTS.md), the [runtime notes](../runtime/README.md), and the host READMEs for [Claude](../hosts/claude/README.md) and [ACP](../hosts/acp/README.md).
