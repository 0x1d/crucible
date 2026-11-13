---
id: crucible/open-items
title: Open Items
type: OI
owner: crucible
status: Draft
date: 2026-11-13
depends: []
related: [crucible/decisions]
---

# Open Items

## 1 Questions for the project owner

| ID | Question | Recommendation | Affects |
| --- | --- | --- | --- |
| OI-01 | Codex split line: does the whole general function library move to the codex repository, or only agent-written entries (existing plan)? | Whole general library; kernel entries stay | crucible/AD-18, crucible/P-07 |
| OI-09 | Does the ACP backend replace homunculus's deferred OpenCode SDK backend (crucible/homunculus/D-22)? | Deferred by the project owner (2026-11-13): the ACP backend does not replace it for now. Decide once crucible/P-05 has an ACP backend and crucible/V-04 is measured | crucible/AD-12, crucible/P-05 |
| OI-10 | Pull homunculus's server-initiated speech (crucible/homunculus/OI-14, crucible/homunculus/D-26) forward? crucible/CH-7 and useful delegation depend on it | Yes, before crucible/CH-5 / crucible/CH-7 | crucible/P-08 |
| OI-11 | May the voice agent `define` codex entries at all? | Off by default; `ask` when enabled | crucible/AD-21 |

## 2 Design questions

| ID | Question | Next step |
| --- | --- | --- |
| OI-04 | Final attribute sets of the `engineering` and `personal` profiles; whether `alias` and `date` belong in both | Confirm crucible/AD-28 in the review of crucible/packages/memory |
| OI-06 | How athanor (Bun) consumes workspace packages: member of the pnpm workspace, or built artifacts. Until then athanor is not a workspace member | Spike: `bun install` inside a pnpm workspace, when athanor first consumes a package |
| OI-07 | Wiki inside `packages/memory` or left in homunculus until a second consumer exists (crucible/R-06) | Confirm crucible/AD-26 in the review of crucible/packages/memory |
| OI-08 | Context policies inside `packages/agent` or their own package | Decide during crucible/P-05 |
| OI-12 | Authentication of the homunculus device and event APIs (crucible/CH-6, crucible/CH-7) | Reuse the pairing / admin token model |
| OI-14 | Mount path syntax (`workspace:path`) and the mount table's configuration format | Write the storage specification |
| OI-15 | Which process serves the storage HTTP API when athanor is not running (alchemist TUI alone, homunculus alone) | Default: `Local` adapter only; `Remote` when configured |
| OI-17 | `MemoryItem` and `RetainResult` shapes that fit both a fact graph and a non-graph provider | Confirm crucible/AD-27 in the review of crucible/packages/memory; crucible/P-04 slice 1 runs the conformance suite against a provider without facts; Hindsight is crucible/V-02 |
| OI-18 | Whether the sidecar's SSE events become `AgentEvent`s as-is or keep their own vocabulary (`component`, `sync`) | Decide during crucible/P-05 |
| OI-19 | Where the three-way sync of [crucible/athanor/api/design/agent-sandbox](../projects/athanor/docs/api/design/agent-sandbox.md) sits once `packages/storage` exists | Revisit when specifying crucible/P-06 |
| OI-20 | Which package defines the tool shape (`name`, `description`, `inputSchema`, `policy`, `call`). `codex-client` and `memory` each export it under their own name (`CodexTool`, `MemoryTool`) with the same structure, because `packages/agent` depends on both | Decide during crucible/P-05: `packages/agent` defines `HostTool` and the two types become aliases, or a types-only package |
| OI-21 | Whether the Cursor host's `@grok/agent-sdk` build and deployment resolve a workspace package (`@crucible/codex-client`) imported from `hosts/cursor/bot/lib` | Try `agent-sdk validate` and a deploy build in crucible/P-03 slice 4; otherwise the Cursor host bundles the package before the build |

## 3 Not yet verified

| ID | Assumption | How to verify |
| --- | --- | --- |
| V-01 | Graph files written by `minigraf` npm 2.0.11 (alchemist) and by temporal-reasoning 0.9.0 (homunculus) are mutually readable | Open a homunculus graph with the alchemist binding and query it. Needed for crucible/P-04 slice 5; if it fails, that slice migrates the graphs |
| V-02 | Hindsight (or another provider) fits `recall` / `retain` / `forget` without interface changes | Read its API; write a stub provider |
| V-03 | `git subtree` import keeps homunculus's LFS pointers intact | Trial import in a scratch clone |
| V-04 | The ACP backend can deliver `interrupt` and streaming text deltas at voice latency | Measure with one ACP agent |

## 4 Carried over

Open items of the projects keep their ids and live with their documents: crucible/homunculus/OI-14 (proactive reminders), crucible/homunculus/OI-15 (speaker identification); the unverified end-to-end run of the athanor prompt-to-component-and-service flow; the Vercel Sandbox spike of crucible/athanor/api/design/agent-sandbox.

## 5 Closed

| ID | Closed by |
| --- | --- |
| OI-02 | crucible/AD-08: monorepo package |
| OI-03 | crucible/AD-10: homunculus uses the minigraf provider; `recall` and `retain` of an exchange are built natively (crucible/P-04 slice 4) |
| OI-05 | crucible/AD-22: pnpm |
| OI-13 | crucible/AD-23. Every branch of the GitHub repositories is in the imported history, `feat/acp-host` included. The remaining `cursor/*` branches on the old alchemist remote hold documentation drafts and a runtime review from October 2026 that later work replaced; dropped |
| OI-16 | crucible/AD-25: `@crucible/<name>`; application names kept |
| V-05 | Verified: the homunculus server test suite passes on Node 24.19 |
