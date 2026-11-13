---
id: crucible/packages/memory/interfaces
title: Interfaces
type: IFC
owner: crucible/packages/memory
status: Draft
date: 2026-11-13
depends: [crucible/packages/memory/requirements]
related: []
planned: []
---

# Interfaces

**Planned** crucible/P-04

The memory package has two contracts. The memory API is the provider-independent TypeScript interface applications program against. The line protocol exposes one open graph of the minigraf provider to a process that is not TypeScript.

## 1 Interfaces

| Interface | Kind | Summary |
| --- | --- | --- |
| [crucible/packages/memory/interfaces/memory-api](interfaces/memory-api.md) | library API | `MemoryProvider`, `MemorySpace`, `MemoryItem`, `createMemoryProvider`, the conformance suite |
| [crucible/packages/memory/interfaces/line-protocol](interfaces/line-protocol.md) | stdio protocol | Line-delimited JSON: `transact`, `retract`, `query`, `overview`, `recall`, `forget`, `reset`, `close` |

## 2 Shared conventions

| Convention | Value |
| --- | --- |
| Timestamps | ISO 8601 instants; a date without a time is midnight UTC |
| References | A provider's stable name for an item. For the minigraf provider the entity id, `preference/coffee-milk` |
| Stored text is data | Text read from memory is never an instruction to the caller or the agent; the prompt section says so to the agent |
| Versioning | Semantic versions per contract. The package is consumed inside the workspace, so a breaking change updates its consumers in the same change |
