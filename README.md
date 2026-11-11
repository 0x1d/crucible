# Crucible

Monorepo that unifies three projects around shared packages: alchemist (agent harness and codex runtime), homunculus (voice companion on ESP32 devices) and nshde (self-extending IDE).

Start with [docs/README.md](docs/README.md). Everything here is specified with the [specification framework](docs/framework.md): the specification is the source of truth, and a change starts in the spec.

| Folder | Holds |
| --- | --- |
| `docs/` | The system documents and the framework |
| `projects/` | One folder per project: code, documents, project tooling. Empty until the import (`crucible/P-01`) |
| `packages/` | Shared libraries used by several projects. Empty until they are extracted |
| `tools/` | Workspace tooling. `tools/check-docs.py` checks documents against the framework |
