---
id: crucible/architecture/repository-and-migration
title: Repository and Migration
type: ARCH
owner: crucible
status: Draft
date: 2026-11-11
depends: [crucible/architecture/system-architecture, crucible/architecture/shared-packages]
related: []
planned:
  - id: crucible/P-01
    title: Monorepo import, root tooling, CI
    depends: []
  - id: crucible/P-02
    title: Documentation restructure
    depends: [crucible/P-01]
  - id: crucible/P-03
    title: packages/codex-client
    depends: [crucible/P-01]
  - id: crucible/P-04
    title: packages/memory
    depends: [crucible/P-01]
  - id: crucible/P-05
    title: packages/agent
    depends: [crucible/P-03, crucible/P-04]
  - id: crucible/P-06
    title: packages/storage
    depends: [crucible/P-01]
  - id: crucible/P-07
    title: Codex repository split
    depends: [crucible/P-06]
  - id: crucible/P-08
    title: Integration channels
    depends: [crucible/P-03, crucible/P-05]
---

# Repository and Migration

## 1 Monorepo layout

Follows the [Formulary workspace layout](https://github.com/0x1d/formulary#workspace-layout).

```text
crucible/
├── docs/                          # cross-project only
│   ├── README.md                  # system manifest and index
│   ├── requirements.md  architecture.md  decisions.md  open-items.md
│   └── architecture/              # sub-documents of architecture.md, this one among them
├── projects/
│   ├── alchemist/
│   │   ├── docs/                  # alchemist components, codex protocol, guides
│   │   ├── runtime/               # BEAM codex runtime (Mix)
│   │   ├── sdk/                   # codex entry SDK (Mix)
│   │   ├── functions/             # kernel entries only
│   │   ├── hosts/<name>/          # Cursor, ACP, ... hosts
│   │   ├── sidecar/               # HTTP + SSE front-end (athanor, delegation)
│   │   └── tui/
│   ├── homunculus/
│   │   ├── docs/                  # homunculus components, HDP
│   │   ├── firmware/
│   │   ├── server/
│   │   ├── protocol/              # HDP
│   │   └── tools/simulator/
│   └── athanor/
│       ├── docs/                  # athanor components
│       ├── ide/                   # today: App.tsx, src/client, src/nshde
│       └── api/                   # today: src/server.ts, src/lib
├── packages/                      # each with its own docs/
│   ├── agent/
│   ├── memory/
│   ├── storage/
│   └── codex-client/
├── tools/                         # workspace scripts
├── AGENTS.md
├── flake.nix                      # one dev shell per project
└── pnpm-workspace.yaml
```

## 2 Codex repository

| Item | Value |
| --- | --- |
| Content | `functions/` (function library and agent-written entries), `components/` (athanor components), `services.json` (published-services manifest) |
| Stays in the monorepo | Kernel entries: `memory.*`, `codex.*`, `runtime.*`, `echo` |
| Moves out | General library: `fs`, `git`, `http`, `md`, `json`, `data`, `docker`, `github`, `text`, `sys`, `util`, `env`, `explore`, ...; `services/*`; `nshde/*` (split line: crucible/OI-01) |
| Loading | Overlay root (`AGENT_CODEX_DIR`): lookup overlay first, then the kernel root; `define` writes to the overlay; shadowing a kernel entry is refused |
| Sync | `codex.sync` entry: clone / pull, commit, push (from the existing alchemist deployment plan) |
| Contract | Depends on the codex entry SDK as a git dependency |
| Tests | Entry tests move with the entries; CI checks out crucible for the runtime |

## 3 Tooling

| Item | Value | Status |
| --- | --- | --- |
| JS workspace | pnpm workspace for `packages/*`, `projects/alchemist`, `projects/homunculus/*` | Proposed (crucible/OI-05) |
| athanor | Keeps Bun and `bun.lock`; consumes packages (crucible/OI-06) | Proposed |
| Node | 24 for all Node projects | Proposed |
| Elixir | `alchemist/runtime`, `alchemist/sdk` as Mix projects | - |
| Nix | One root flake; dev shells `default` (Node, Elixir), `firmware` (ESP-IDF), `athanor` (Bun, NSH) | Proposed |
| Git LFS | Path-scoped patterns for `homunculus/**` binaries in the root `.gitattributes` | Required |
| Commits | Conventional Commits, scope = project or package | Proposed |

## 4 History import

| Step | Detail |
| --- | --- |
| 1 | Merge or drop unmerged remote branches (`alchemist`: `feat/acp-host`, `ccr-42861548-wocrlg`; `athanor`: `ccr-42861548-wocrlg`, `claude/*`) (crucible/OI-13) |
| 2 | `git init` in `crucible/`; import each repository under `projects/<name>/` with history (`git subtree add` or `git filter-repo`) |
| 3 | Fetch homunculus LFS objects before the import; rewrite `.gitattributes` to path-scoped patterns |
| 4 | Archive the three source repositories (read-only) |

## 5 Documentation migration

Each project keeps its documents under `projects/<project>/docs/`, restructured per the [Formulary standard](https://github.com/0x1d/formulary). `docs/` keeps only the system documents.

Components and their [profiles](https://github.com/0x1d/formulary/blob/main/profiles.md):

| Component | Profile | Docs |
| --- | --- | --- |
| `crucible` | system | `docs/` |
| `crucible/homunculus/firmware` | device | `projects/homunculus/docs/firmware/` |
| `crucible/homunculus/server` | service | `projects/homunculus/docs/server/` |
| `crucible/homunculus/hdp` | protocol | `projects/homunculus/docs/hdp/` |
| `crucible/athanor/ide` | app | `projects/athanor/docs/ide/` |
| `crucible/athanor/api` | service | `projects/athanor/docs/api/` |
| `crucible/alchemist/runtime` | service | `projects/alchemist/docs/runtime/` |
| `crucible/alchemist/tui` | app | `projects/alchemist/docs/tui/` |
| `crucible/alchemist/host-<name>` (code `hosts/<name>/`) | integration | `projects/alchemist/docs/host-<name>/` |
| `crucible/alchemist/codex-protocol` | protocol | `projects/alchemist/docs/codex-protocol/` |
| `crucible/packages/<name>`: `agent`, `memory`, `storage`, `codex-client` | library | `packages/<name>/docs/` |

Moves:

| Source | Target |
| --- | --- |
| `homunculus/docs/specification/*` | `projects/homunculus/docs/{firmware,server,hdp}/`; decisions `D-NN` and open items keep their ids, prefixed `HOM-` |
| `homunculus/docs/devices/` | `projects/homunculus/docs/firmware/hardware/<board>.md` |
| `alchemist/docs/{concepts,reference}` | `projects/alchemist/docs/{runtime,codex-protocol}/` |
| `alchemist/docs/guides` | `projects/alchemist/docs/guides/` |
| `alchemist/docs/internal/{plans,specs}` - implemented | Content folded into the component documents; files removed |
| `alchemist/docs/internal/{plans,specs}` - proposed / planned | A **Planned** section in the component document, with an id and its dependencies; files removed |
| `athanor/docs/internal/plans/001-006` (done) | `projects/athanor/docs/ide/`; files removed |
| `athanor/docs/internal/plans/007-009`, alchemist `2026-11-10-nshde-deployment` | `projects/athanor/docs/api/` deployment and access-control sections marked **Planned**; cross-project decisions to `crucible/decisions` |
| `docs/architecture/shared-packages.md` interface details | `packages/<package>/docs/interfaces.md`; `crucible/architecture/shared-packages` keeps responsibilities and links |
| `AGENTS.md` per project | One root `AGENTS.md` plus short per-project files |

Removed files remain in git history.

## 6 Planned work

The migration is a set of planned changes that form a dependency graph ([Formulary](https://github.com/0x1d/formulary#planned-work)). The dependencies are declared under `planned` in this document's front matter; the graph and the table are a view of them. There are no dates and no fixed order: a change may start when everything it depends on is done.

```mermaid
flowchart LR
    P01["P-01 import, tooling, CI"] --> P02["P-02 documentation"]
    P01 --> P03["P-03 codex-client"]
    P01 --> P04["P-04 memory"]
    P01 --> P06["P-06 storage"]
    P03 --> P05["P-05 agent"]
    P04 --> P05
    P06 --> P07["P-07 codex repository"]
    P03 --> P08["P-08 integration"]
    P05 --> P08
```

| Id | Content | Depends on | Behaviour change | State |
| --- | --- | --- | --- | --- |
| P-01 | Monorepo import, root tooling, CI | - | None | ready |
| P-02 | Documentation restructure (section 5) | crucible/P-01 | None | blocked |
| P-03 | `packages/codex-client` | crucible/P-01 | None | blocked |
| P-04 | `packages/memory`: interface, minigraf provider; alchemist and homunculus switched | crucible/P-01 | Homunculus may keep the interim provider | blocked |
| P-05 | `packages/agent`: interfaces, Claude backend, context policies; sidecar, TUI and homunculus switched; ACP backend | crucible/P-03, crucible/P-04 | None intended | blocked |
| P-06 | `packages/storage` + `AgentLib.Storage`; `fs.*` on mounts | crucible/P-01, entry SDK | `fs.*` restricted to mounts | blocked |
| P-07 | Codex repository split, overlay, `codex.sync` | crucible/P-06, entry SDK | Functions load from the overlay | blocked |
| P-08 | Integration crucible/CH-4, crucible/CH-6, then crucible/CH-5 + crucible/CH-7 | crucible/P-03, crucible/P-05 | New features | blocked |

crucible/P-07 may be needed early, if the athanor deployment requires it.
