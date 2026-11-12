# Crucible - Agent notes

## Read first

- [Formulary](https://github.com/0x1d/formulary), the standard the documents conform to; section "For agents"
- [System manifest and index](docs/README.md) -> project index -> component manifest -> documents

## Rules

- The specification is the source of truth. Edit the spec before the code, and report where code and spec disagree.
- Refer to every artifact by its full id. A document's id is its path.
- Relations between documents live in front matter (`depends`, `related`, `planned`), not in the text.
- Written text is plain ASCII: `-` for dashes, `->` for arrows, words instead of symbols.
- Commits follow Conventional Commits; the scope is the project or package (`feat(homunculus): ...`).

## Before finishing

- Formulary's conformance check, run from the workspace root: `python3 formulary/check-docs.py` (`pnpm check:docs`)
- For code changes, in the root dev shell: `pnpm typecheck` and `pnpm test`; athanor: `bun test src` in `nix develop .#athanor`
