---
id: crucible/architecture/repository-layout
title: Repository Layout
type: ARCH
owner: crucible
status: Draft
date: 2026-11-13
depends: [crucible/architecture/system-architecture]
related: [crucible/development, crucible/increments/repository-and-migration]
planned: []
---

# Repository Layout

Crucible is one git repository that follows the [Formulary workspace layout](https://github.com/0x1d/formulary#workspace-layout): system documents in `docs/`, one folder per project under `projects/`, shared libraries under `packages/`, and only workspace configuration at the root. The three projects were imported with their full history; their source repositories are archived. How to build and test the workspace is in [crucible/development](../development.md); the layout changes still planned are in [crucible/increments/repository-and-migration](../increments/repository-and-migration.md).

## 1 Workspace

```text
crucible/
├── docs/                          # system documents only
│   ├── README.md                  # system manifest and index
│   ├── requirements.md  architecture.md  development.md  increments.md
│   ├── decisions.md  open-items.md
│   ├── architecture/              # sub-documents of architecture.md
│   └── increments/                # one document per product increment
├── projects/
│   ├── alchemist/
│   │   ├── docs/                  # alchemist components, codex protocol, guides
│   │   ├── runtime/               # BEAM codex runtime (Mix)
│   │   ├── functions/             # codex entries
│   │   ├── core/                  # shared TypeScript: Elixir bridge, minigraf memory, protocol
│   │   ├── hosts/<name>/          # claude, cursor, acp, nshde hosts
│   │   └── tui/
│   ├── homunculus/
│   │   ├── docs/                  # homunculus components, HDP
│   │   ├── firmware/
│   │   ├── server/
│   │   ├── protocol/              # HDP
│   │   └── tools/simulator/
│   ├── athanor/
│   │   ├── docs/                  # athanor components
│   │   ├── App.tsx  src/client/  src/nshde/    # ide
│   │   └── src/server.ts  src/lib/             # api
│   └── formulary/                 # git submodule: the documentation standard and its check
├── packages/                      # shared libraries: <package>/docs/ and <package>/src/
├── site/                          # documentation site: Quartz config, lockfile, build script
├── .github/workflows/          # ci.yml (code), docs.yml (documents and site)
├── .gitattributes                 # Git LFS patterns
├── AGENTS.md
├── flake.nix                      # dev shells for all projects
├── package.json                   # root scripts, pnpm pin
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

| Folder | Rule |
| --- | --- |
| `projects/<project>/` | Everything one project owns: code, documents, project tooling, its own flake. Projects never import from each other's folders |
| `packages/<package>/` | A library with consumers in more than one project, specified as a `library` component in `packages/<package>/docs/` |
| Root | Workspace configuration only: workspace, lockfile, flake, CI, LFS patterns, the documentation site build (`site/`) |

## 2 Components

Every component has a [Formulary profile](https://github.com/0x1d/formulary/blob/main/profiles.md) and keeps its documents in the project or package that owns its code.

| Component | Profile | Documents |
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
| `crucible/packages/<name>` | library | `packages/<name>/docs/` |

| Rule | Detail |
| --- | --- |
| Project items | Items that predate the standard keep their local form and are referred to by their full id: `crucible/homunculus/D-22`, `crucible/homunculus/OI-14` |
| Agent notes | One root `AGENTS.md`, plus a short `AGENTS.md` per project for what only that project needs |
| Plans | There are no dated plan or specification files. Work that is not built is a **Planned** section of the document that will describe it |

## 3 Origin

| Project | Imported from | Method |
| --- | --- | --- |
| alchemist | `0x1d/alchemist`, archived read-only | `git subtree add` under `projects/alchemist/`, full history |
| homunculus | `0x1d/homunculus`, archived read-only | `git subtree add` under `projects/homunculus/`, full history; LFS objects fetched before the import |
| athanor | `0x1d/athanor`, archived read-only | `git subtree add` under `projects/athanor/`, full history |

Git LFS covers the homunculus binaries only: the root `.gitattributes` holds path-scoped patterns (`projects/homunculus/**/*.bin`, ...).
