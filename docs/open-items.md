---
id: crucible/open-items
title: Open Items
type: OI
owner: crucible
status: Draft
date: 2026-11-10
depends: []
related: [crucible/decisions]
---

# Open Items

## 1 Questions for the project owner

| ID | Question | Recommendation | Affects |
| --- | --- | --- | --- |
| OI-01 | Codex split line: does the whole general function library move to the codex repository, or only agent-written entries (existing plan)? | Whole general library; kernel entries stay | crucible/AD-18, crucible/P-07 |
| OI-02 | Memory layer as a monorepo package or its own repository? | Monorepo package | crucible/AD-08, crucible/P-04 |
| OI-05 | Package manager for the workspace: pnpm? | pnpm | crucible/AD-22, crucible/P-01 |
| OI-09 | Does the ACP backend replace homunculus's deferred OpenCode SDK backend (HOM D-22)? | Yes, if OpenCode over ACP meets the interrupt and streaming needs | crucible/AD-12, crucible/P-05 |
| OI-10 | Pull homunculus's server-initiated speech (HOM OI-14, D-26) forward? crucible/CH-7 and useful delegation depend on it | Yes, before crucible/CH-5 / crucible/CH-7 | crucible/P-08 |
| OI-11 | May the voice agent `define` codex entries at all? | Off by default; `ask` when enabled | crucible/AD-21 |
| OI-13 | Unmerged remote branches in alchemist and athanor: merge or drop before the import? | Review each; merge `feat/acp-host` if current | crucible/P-01 |
| OI-16 | Package scope and names (`@crucible/agent`, ...); do the applications keep their names? | `@crucible/*`; names kept | crucible/P-01 |

## 2 Design questions

| ID | Question | Next step |
| --- | --- | --- |
| OI-03 | Port `recall` and `retain`-by-exchange (retrieval index, extraction prompt) to the native minigraf provider, or keep temporal-reasoning as the provider for homunculus | Compare retrieval quality and latency of both on the homunculus fixtures |
| OI-04 | Final attribute sets of the `engineering` and `personal` profiles; whether `alias` and `date` belong in both | Write the memory specification |
| OI-06 | How athanor (Bun) consumes workspace packages: member of the pnpm workspace, or built artifacts | Spike: `bun install` inside a pnpm workspace |
| OI-07 | Wiki inside `packages/memory` or left in homunculus until a second consumer exists (crucible/R-06) | Decide in the memory specification |
| OI-08 | Context policies inside `packages/agent` or their own package | Decide during crucible/P-05 |
| OI-12 | Authentication of the homunculus device and event APIs (crucible/CH-6, crucible/CH-7) | Reuse the pairing / admin token model |
| OI-14 | Mount path syntax (`workspace:path`) and the mount table's configuration format | Write the storage specification |
| OI-15 | Which process serves the storage HTTP API when athanor is not running (alchemist TUI alone, homunculus alone) | Default: `Local` adapter only; `Remote` when configured |
| OI-17 | `MemoryItem` and `RetainResult` shapes that fit both a fact graph and a non-graph provider | Draft against minigraf and Hindsight |
| OI-18 | Whether the sidecar's SSE events become `AgentEvent`s as-is or keep their own vocabulary (`component`, `sync`) | Decide during crucible/P-05 |
| OI-19 | Where the three-way sync of athanor plan 008 sits once `packages/storage` exists | Revisit when migrating the deployment plans |

## 3 Not yet verified

| ID | Assumption | How to verify |
| --- | --- | --- |
| V-01 | Graph files written by `minigraf` npm 2.0.11 (alchemist) and by temporal-reasoning 0.9.0 (homunculus) are mutually readable | Open a homunculus graph with the alchemist binding and query it |
| V-02 | Hindsight (or another provider) fits `recall` / `retain` / `forget` without interface changes | Read its API; write a stub provider |
| V-03 | `git subtree` import keeps homunculus's LFS pointers intact | Trial import in a scratch clone |
| V-04 | The ACP backend can deliver `interrupt` and streaming text deltas at voice latency | Measure with one ACP agent |
| V-05 | A single Node 24 baseline works for the homunculus server's native dependencies (`onnxruntime-node`, `opusscript`) | Run the homunculus test suite on Node 24 |

## 4 Carried over

Open items of the projects keep their ids and move with their documents: homunculus `OI-14` (proactive reminders), `OI-15` (speaker identification); the unverified end-to-end run of the athanor prompt-to-component-and-service flow; the Vercel Sandbox spike of athanor plan 008.
