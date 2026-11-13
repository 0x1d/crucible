---
id: crucible/alchemist/host-acp/interfaces
title: Interfaces
type: IFC
owner: crucible/alchemist/host-acp
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-acp/requirements]
related: []
planned: []
---

# Interfaces

The ACP host has one external interface: the Agent Client Protocol toward the agent, with Alchemist as the client. Its contract maps ACP's messages and concepts onto the terminal UI's host events and onto the codex tools. Toward the terminal UI the host implements `HostAdapter`, which the terminal UI owns, so it is not a contract of this component.

## 1 Interfaces

| Interface | Kind | Summary |
| --- | --- | --- |
| [crucible/alchemist/host-acp/interfaces/agent-client-protocol](interfaces/agent-client-protocol.md) | stdio JSON-RPC | The ACP messages the host sends and serves, and their mapping |

## 2 Shared conventions

Not applicable - the component has one interface.
