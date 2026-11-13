---
id: crucible/decisions
title: Decisions
type: AD
owner: crucible
status: Draft
date: 2026-11-13
depends: []
related: [crucible/open-items]
---

# Decisions

Status values: **Decided** (stated by the project owner), **Proposed** (recommended in the review, not yet confirmed), **Superseded**.

## 1 Decided

| ID | Decision | Rationale | Alternatives considered |
| --- | --- | --- | --- |
| AD-01 | The three projects are unified in one git monorepo (`crucible`) | They integrate with each other; shared code needs one place | Separate repositories with published packages |
| AD-02 | The alchemist function library (codex) lives in a separate repository | It is content that agents write and that deployments sync; its lifecycle differs from the runtime's | Keep `functions/` in the monorepo |
| AD-03 | Memory is a generic, provider-independent interface; providers are swappable | Freedom to adopt another memory layer later (e.g. Hindsight) without touching hosts | Standardise on the minigraf API |
| AD-04 | Minigraf is the first memory provider | Both projects already use it | - |
| AD-05 | Alchemist and homunculus share memory functionality, not memory content: each owns its own graph | Different domains (engineering vs personal); no shared owner process needed | One shared graph behind a memory service (rejected) |
| AD-06 | File access is shared: alchemist's `fs.*` entries and athanor's storage use the same storage layer | Two file layers exist today; athanor files need a second set of entries | Keep `nshde.component.*` beside `fs.*` |
| AD-07 | Documentation follows the architecture / specification / application-design style; the dated `plans/` and `specs/` records are discontinued | Preference of the project owner; homunculus already follows it | Keep per-feature plan and spec files |
| AD-22 | pnpm workspace on Node 24 for alchemist, homunculus and packages; athanor keeps Bun; one root Nix flake with per-project shells | Homunculus already uses pnpm; athanor requires Bun (crucible/C-03) | npm workspaces; Bun everywhere |
| AD-23 | History is preserved on import; source repositories are archived | 272 commits of context | Fresh start |
| AD-08 | The memory layer is a package in the monorepo (`packages/memory`), not its own repository. Decided 2026-11-13, closes crucible/OI-02 | Co-evolves with both consumers; a repository boundary adds version pinning only | Separate repository |
| AD-10 | Alchemist's native minigraf code is the base of the minigraf provider. Alchemist and homunculus both use that provider; the temporal-reasoning client is not carried into the package and is removed when homunculus switches. Decided 2026-11-13, closes crucible/OI-03 | Removes the Python / `uvx` dependency and the crucible/homunculus/D-28 workaround; strict validation, tested; one implementation (crucible/requirements section 4) | Base on temporal-reasoning; keep temporal-reasoning as the homunculus provider |
| AD-25 | Shared packages are named `@crucible/<name>` (`@crucible/codex-client`, `@crucible/memory`, `@crucible/agent`, `@crucible/storage`); the applications keep their names. Decided 2026-11-13, closes crucible/OI-16 | One scope shows what belongs to the workspace; renaming the applications gains nothing | Per-project scopes; unscoped names |
| AD-24 | The IDE project nshde is renamed athanor (repository `0x1d/athanor`), after the alchemist's self-feeding furnace | Matches the alchemy naming of crucible, alchemist, homunculus and codex | Ouroboros, retort, alembic (name taken by a Python tool) |

## 2 Proposed

| ID | Decision | Rationale | Alternatives considered | Open item |
| --- | --- | --- | --- | --- |
| AD-09 | The generic memory interface is `recall` / `retain` / `forget` plus provider-contributed `tools()` and `promptSection()` | Does not assume a fact graph; matches homunculus's prepare / finalize and Hindsight's API | Datalog-level interface | - |
| AD-11 | Minigraf schema differences are expressed as profiles (`engineering`, `personal`) | Same namespaces, different attribute sets | One merged attribute set | crucible/OI-04 |
| AD-12 | The agent abstraction is homunculus's inference layer, extracted as `packages/agent`; ACP becomes a second backend | Backend-neutral, has interrupt and a permission model; both projects wrap the same SDK | Alchemist's `runSession` as the base | crucible/OI-09 |
| AD-13 | Context policies (host flags, handoff, result digest, caps, explore gate, auto-retain) move from the Cursor host into `packages/agent` | Three other hosts import them from the Cursor host's folder | Own package | crucible/OI-08 |
| AD-14 | The Cursor host stays an alchemist host and is not an agent backend | `@grok/agent-sdk` is its own harness (crucible/C-06) | - | - |
| AD-15 | `packages/codex-client` holds the bridge, protocol and codex tool server | Every host and both other applications need it | Keep in `alchemist/core` | - |
| AD-16 | `packages/storage` extends athanor's `StorageProvider`; the BEAM reaches it through `AgentLib.Storage` with `Local` and `Remote` adapters; paths are mount-qualified | One file layer across TypeScript and Elixir; gives `fs.*` a boundary | Port providers to Elixir | crucible/OI-14, crucible/OI-15 |
| AD-17 | A codex entry SDK (Mix package) is the contract between the monorepo and the codex repository | The library must compile and test against a pinned contract | Codex repository vendors the behaviours | - |
| AD-18 | Kernel entries (`memory.*`, `codex.*`, `runtime.*`, `echo`) stay in the monorepo; the general library moves to the codex repository; loading uses the overlay root | Kernel entries are coupled to runtime internals | Only agent-written entries move (existing plan) | crucible/OI-01 |
| AD-19 | A package is created only for code with two consumers; HDP and speech stay in homunculus | Avoid speculative packages | Extract everything reusable | - |
| AD-20 | Applications integrate over channels crucible/CH-1...CH-7; TypeScript -> BEAM through `codex-client`, BEAM -> applications through their HTTP APIs | Reuses the two patterns that exist today | Message bus; shared in-process runtime | - |
| AD-21 | In homunculus, `define` is off by default and `ask` when enabled | crucible/C-01 | Allow | crucible/OI-11 |
| AD-26 | The homunculus wiki (Markdown pages, search, git commit per change) stays in homunculus; `packages/memory` holds the memory interface and its providers only | One consumer (crucible/AD-19); the wiki is a document store, not a memory provider | Optional second store inside the package | crucible/OI-07 |
| AD-27 | A memory item is a text statement with an optional provider reference, kind, attributes, validity window and score; a retain result lists what was stored and what was rejected ([crucible/packages/memory/interfaces/memory-api](../packages/memory/docs/interfaces/memory-api.md)) | A fact graph maps an entity to it; a provider without facts fills `text` only | Entity / attribute / value triples in the generic interface | crucible/OI-17 |
| AD-28 | The `engineering` and `personal` profiles keep the attribute sets alchemist and homunculus use today; `alias` and `date` are in `personal` only ([crucible/packages/memory/design/minigraf-provider](../packages/memory/docs/design/minigraf-provider.md)) | The package extraction changes no stored data | One merged attribute set | crucible/OI-04 |

## 3 Carried over

Project decisions keep their ids and live with their documents ([crucible/architecture/repository-layout](architecture/repository-layout.md) section 2): [crucible/homunculus/decisions](../projects/homunculus/docs/decisions.md) holds `crucible/homunculus/AD-01...AD-07` and `crucible/homunculus/D-NN`; the decisions on the codex repository layout, the sandbox and the sync rules are in the athanor and alchemist deployment documents.
