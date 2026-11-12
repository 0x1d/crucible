---
id: crucible/architecture/repository-layout
title: Repository Layout
type: ARCH
owner: crucible
status: Draft
date: 2026-11-12
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
├── packages/                      # shared libraries; empty until the first is extracted
├── site/                          # documentation site: Quartz config, lockfile, build script
├── .github/workflows/ci.yml
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

## 2 Origin

| Project | Imported from | Method |
| --- | --- | --- |
| alchemist | `0x1d/alchemist`, archived read-only | `git subtree add` under `projects/alchemist/`, full history |
| homunculus | `0x1d/homunculus`, archived read-only | `git subtree add` under `projects/homunculus/`, full history; LFS objects fetched before the import |
| athanor | `0x1d/athanor`, archived read-only | `git subtree add` under `projects/athanor/`, full history |

Git LFS covers the homunculus binaries only: the root `.gitattributes` holds path-scoped patterns (`projects/homunculus/**/*.bin`, ...).
