---
id: crucible/development
title: Development
type: DEV
owner: crucible
status: Draft
date: 2026-11-12
depends: [crucible/architecture/repository-layout]
related: [crucible/alchemist/development, crucible/homunculus/development]
planned: []
---

# Development

The workspace is built and tested from the root: a Nix flake provides one dev shell per toolchain, a pnpm workspace with one lockfile covers every Node project except athanor, and the root scripts run the checks of all members. CI runs the same commands in the same shells. What is specific to one project is in its own `development.md`.

## 1 Prerequisites

| Tool | Version | Needed for | Provided by |
| --- | --- | --- | --- |
| Nix with flakes | - | All dev shells | Manual install |
| Node | 24, stated in `engines` | alchemist, homunculus server, packages | `default` and `athanor` shells |
| pnpm | 10, pinned by `packageManager` in the root `package.json` | The JS workspace | `default` shell |
| Elixir, Erlang | Elixir 1.20 | `projects/alchemist/runtime` (Mix) | `default` shell |
| Python 3 | - | The docs conformance check | `default` shell |
| gh | - | GitHub CLI | `default` shell |
| Bun | - | athanor | `athanor` shell |
| ESP-IDF | - | homunculus firmware | `firmware` shell |
| NSH CLI | - | athanor | Manual install per machine, outside Nix |
| Git LFS | - | homunculus binaries | `default` shell |

## 2 Setup

1. Clone with the submodule: `git clone --recurse-submodules <url>`, or `git submodule update --init` in an existing checkout.
2. Enter a shell: `nix develop` (default), `nix develop .#athanor`, `nix develop .#firmware`, `nix develop .#homunculus-server`. The root flake is built on the project flakes, which stay usable on their own.
3. In the default shell: `pnpm install`.

| Item | Value |
| --- | --- |
| JS workspace | Root `pnpm-workspace.yaml` with the members `packages/*`, `projects/alchemist`, `projects/homunculus/{protocol,server,tools/*}`; one `pnpm-lock.yaml` at the root. Workspace-wide settings (`packageExtensions`) live in the root file. npm lockfiles are not kept |
| athanor | Keeps Bun and `bun.lock`; not a workspace member until it consumes a package (crucible/OI-06) |

## 3 Everyday commands

| Task | Command | Notes |
| --- | --- | --- |
| Type check | `pnpm typecheck` | Runs `typecheck` in every workspace member |
| Test | `pnpm test` | Runs `test` in every member: alchemist (Mix runtime and functions suites, docs-check, TUI, core and host tests), homunculus (protocol, server, simulator) |
| Docs check | `pnpm check:docs` | Formulary's `check-docs.py` on the whole workspace |
| athanor | `bun install`, `bun run lint`, `bun test src` | In `nix develop .#athanor`, in `projects/athanor` |
| Firmware | `make fw-build` | In `nix develop .#firmware`, in `projects/homunculus` |

### 3.1 Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request. Each job runs inside a root Nix shell, so CI uses the toolchain of the dev shells.

| Job | Shell | Steps |
| --- | --- | --- |
| `docs` | none | Formulary's `check-docs.py` on the workspace, from the `formulary` submodule at its pinned commit |
| `workspace` | `default` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` |
| `athanor` | `athanor` | `bun install --frozen-lockfile`, `bun run lint`, `bun test src` |
| `site` | `default` | `site/build.sh`: builds the documentation site (section 3.2) and uploads it as the Pages artifact |
| `pages` | none | Deploys the `site` artifact to GitHub Pages; on pushes to `main` only, after `docs` and `site` pass |

The firmware is not built in CI: the ESP-IDF toolchain is built locally.

### 3.2 Documentation site

The documents of the whole workspace are published as a static site at https://0x1d.github.io/crucible, built with [Quartz](https://quartz.jzhao.xyz/) by the `site` and `pages` jobs. Locally, `pnpm site` builds it into `site/public/`.

| Item | Value |
| --- | --- |
| Content | `docs/`, `projects/*/docs/` and `packages/*/docs/`, at their repository paths, so relative links between documents keep working; a generated `index.md` links the system manifest and every project manifest |
| Links out of the site | A relative link to a file outside these folders (code, `AGENTS.md`, a project README) is rewritten to the file on GitHub at the built commit |
| Quartz | Cloned at a pinned tag (`QUARTZ_REF` in `site/build.sh`) into `site/.quartz/`, not committed |
| Configuration | `site/quartz.config.yaml`, based on the `xdflatline/quartz` configuration; no analytics, dates from front matter, GitHub-style line breaks |
| Plugins | Pinned to commits in `site/quartz.lock.json`; after changing plugins in the configuration, run `npx quartz plugin install --from-config` in `site/.quartz/` and copy its `quartz.lock.json` back |
| Front matter | Must be valid YAML for the site build: values that contain `: ` are quoted |
| Pages setup | Repository setting Pages, source "GitHub Actions" |

## 4 Running locally

Not applicable - each project runs on its own; see the project's `development.md`.

## 5 Target hardware

Not applicable - flashing and on-device debugging are in [crucible/homunculus/development](../projects/homunculus/docs/development.md).

## 6 Debugging

Not applicable - per project.

## 7 Conventions

| Item | Value |
| --- | --- |
| Commits | Conventional Commits; the scope is the project or package (`feat(homunculus): ...`) |
| Before a change is finished | `pnpm check:docs`; for code, `pnpm typecheck` and `pnpm test`, and `bun test src` for athanor |
| Agent notes | [AGENTS.md](../AGENTS.md) at the root, short per-project `AGENTS.md` files |

## 8 Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docs` job or `pnpm check:docs` cannot find `projects/formulary/check-docs.py` | Submodule not checked out | `git submodule update --init` |
