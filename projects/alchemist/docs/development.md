---
id: crucible/alchemist/development
title: Development
type: DEV
owner: crucible/alchemist
status: Draft
date: 2026-11-11
depends: []
related: []
planned: []
---

# Development

Date: 2026-10-25  
Status: approved design

## Goal

Let NixOS (and other Nix) users enter a reproducible project shell via direnv, with Node and Elixir on PATH, without changing the non-Nix workflow.

## Decisions

- **Both** `flake.nix` (primary) and `shell.nix` (fallback for non-flake users).
- **Shared shell**: `shell.nix` is the single source of truth for packages and `shellHook`; `flake.nix` calls it via `pkgs.callPackage ./shell.nix {}`.
- **Bootstrap**: tools only + reminder `shellHook` when `node_modules` or `runtime/deps` is missing. No auto `npm install` / `mix deps.get`.

## Files

| Path | Purpose |
| --- | --- |
| `shell.nix` | `mkShell` with packages + reminder hook |
| `flake.nix` | Pin `nixpkgs`, expose `devShells.default` from `shell.nix` |
| `.envrc` | Prefer `use flake`, fall back to `use nix` |
| `.gitignore` | Add `.direnv/` |
| `README.md` | "Nix / NixOS" subsection under Prerequisites |

## Packages

Match README prerequisites:

- `nodejs_22` (Node 22.13+)
- `elixir` (1.14+)
- `erlang` (required runtime for Elixir)

No Hex, Rebar, or npm packages in the Nix shell; those stay project-local (`runtime/deps`, `node_modules`).

## shellHook

On shell enter:

1. If `node_modules` is absent -> print one line: run `npm install`.
2. If `runtime/deps` is absent -> print one line: run `mix local.hex --force && mix local.rebar --force && (cd runtime && mix deps.get)`.

Do not install or mutate the tree from the hook.

## .envrc

- Prefer flake: `use flake`.
- If flake evaluation fails or flakes are disabled: `use nix`.
- Recommend `nix-direnv` in README for faster reloads; `.envrc` should work with stock direnv as well.

## README

Under **Prerequisites**, add a short **Nix / NixOS** section covering:

1. Optional: enable flakes.
2. Install `direnv` (+ preferred `nix-direnv`).
3. Hook direnv into the shell; `cd` to the repo; `direnv allow`.
4. Then the existing mix/npm steps.
5. Note that non-Nix users can ignore these files.

## Out of scope

- Packaging the app as a Nix derivation / `nix build`
- NixOS module / home-manager module
- Pinning exact Elixir/OTP patch versions beyond what the chosen `nixpkgs` channel provides
- CI changes

## Success criteria

- On NixOS with direnv: `cd` into the repo -> Node and Elixir available; missing-deps reminders if needed.
- Without flakes: `nix-shell` / `use nix` still works via `shell.nix`.
- Existing Node/Elixir docs and scripts remain valid for non-Nix users.
