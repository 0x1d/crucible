---
id: crucible/packages/codex-client/interfaces
title: Interfaces
type: IFC
owner: crucible/packages/codex-client
status: Draft
date: 2026-11-13
depends: [crucible/packages/codex-client/requirements]
related: []
planned: []
---

# Interfaces

**Planned** crucible/P-03

The codex client has two contracts: the library API that TypeScript consumers import, and the `codex` command for shells and scripts. Both send the same codex requests and return the same results.

## 1 Interfaces

| Interface | Kind | Summary |
| --- | --- | --- |
| [crucible/packages/codex-client/interfaces/library-api](interfaces/library-api.md) | library API | `createCodexClient`, `run`, `stop`, `codexTools`, protocol types |
| [crucible/packages/codex-client/interfaces/command-line](interfaces/command-line.md) | CLI | `codex '<json request>'` |

## 2 Shared conventions

| Convention | Value |
| --- | --- |
| Requests | The codex requests of [crucible/alchemist/codex-protocol/interfaces/codex-protocol](../../../projects/alchemist/docs/codex-protocol/interfaces/codex-protocol.md); this package adds no operation |
| Results | A JSON object with `ok`. `ok: false` carries `error` as text. Failures of the client itself (start, transport, timeout) have the same form |
| Configuration | Options first, then environment variables, then defaults ([crucible/packages/codex-client/design](design.md) section 5) |
| Versioning | Semantic versions per contract. The package is consumed inside the workspace (`workspace:*`), so a breaking change updates its consumers in the same change |
