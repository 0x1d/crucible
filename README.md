# Crucible

Monorepo that unifies three projects around shared packages: alchemist (agent harness and codex runtime), homunculus (voice companion on ESP32 devices) and athanor (self-extending IDE).

Start with [docs/README.md](docs/README.md). Everything here is specified to the [Formulary standard](https://github.com/0x1d/formulary): the specification is the source of truth, and a change starts in the spec.

| Folder | Holds |
| --- | --- |
| `docs/` | The system documents |
| `projects/` | One folder per project: code, documents, project tooling |
| `packages/` | Shared libraries used by several projects. Empty until they are extracted |
| `tools/` | Workspace tooling. Empty for now; the docs conformance check is Formulary's `check-docs.py` |

## Development

The root Nix flake has a dev shell per toolchain ([crucible/development](docs/development.md)):

```bash
nix develop                 # Node 24, pnpm, Elixir: alchemist, homunculus server, packages
nix develop .#athanor       # Bun
nix develop .#firmware      # ESP-IDF
```

In the default shell:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm check:docs
```
