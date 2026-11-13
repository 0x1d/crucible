# Homunculus - Agent notes

## Read first

- [Workspace agent notes](../../AGENTS.md)
- [Homunculus index](docs/README.md) -> component manifest -> documents
- [Development](docs/development.md) for the dev shells, checks and flashing

## Rules

- Item ids predate the standard and are kept (`FR-NN`, `NFR-NN`, `D-NN`, `OI-NN`, `R-NN`); refer to them by their full id, `crucible/homunculus/D-22`.
- Binaries under `firmware/` are Git LFS objects; do not commit them as plain files.
- The firmware needs the ESP-IDF shell; server and protocol work does not.

## Before finishing

- Server and protocol: `pnpm typecheck` and `pnpm test` in the root dev shell
- Firmware: the checks in [Development](docs/development.md)
