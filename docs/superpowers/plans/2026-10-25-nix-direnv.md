# Nix shell + direnv Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Nix dev shell (flake + classic `shell.nix`) and direnv so NixOS users get Node 22 and Elixir on PATH with missing-deps reminders.

**Architecture:** `shell.nix` is the single `mkShell` definition (packages + `shellHook`). `flake.nix` pins `nixpkgs` and exposes that shell as `devShells.default` via `pkgs.callPackage ./shell.nix {}`. `.envrc` prefers `use flake` and falls back to `use nix`. README documents the NixOS workflow under Prerequisites.

**Tech Stack:** Nix flakes, classic `shell.nix`, direnv, nixpkgs (`nodejs_22`, `elixir`, `erlang`)

## Global Constraints

- Node floor: 22.13+ (provide `nodejs_22`)
- Elixir floor: 1.14+ (provide `elixir` + `erlang`)
- No auto `npm install` / `mix deps.get` in the hook — reminders only
- `shell.nix` is canonical; flake must not duplicate package lists
- Non-Nix users ignore these files; do not break existing npm/mix docs
- Spec: `docs/superpowers/specs/2026-10-25-nix-direnv-design.md`

---

## File structure

| File | Responsibility |
| --- | --- |
| `shell.nix` | Packages + reminder `shellHook` |
| `flake.nix` | Pin nixpkgs; wrap `shell.nix` as `devShells.default` |
| `.envrc` | `use flake` with `use nix` fallback |
| `.gitignore` | Ignore `.direnv/` |
| `README.md` | Nix / NixOS subsection under Prerequisites |

---

### Task 1: Canonical `shell.nix`

**Files:**
- Create: `shell.nix`
- Test: manual via `nix-shell --run 'node -v; elixir -v'`

**Interfaces:**
- Consumes: nixpkgs `mkShell`, `nodejs_22`, `elixir`, `erlang`
- Produces: callable package `{ pkgs ? import <nixpkgs> {} }: pkgs.mkShell { ... }` for flake `callPackage` and classic `nix-shell`

- [ ] **Step 1: Create `shell.nix`**

```nix
{
  pkgs ? import <nixpkgs> { },
}:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    elixir
    erlang
  ];

  shellHook = ''
    if [ ! -d node_modules ]; then
      echo "hint: run npm install"
    fi
    if [ ! -d runtime/deps ]; then
      echo "hint: run mix local.hex --force && mix local.rebar --force && (cd runtime && mix deps.get)"
    fi
  '';
}
```

- [ ] **Step 2: Verify classic shell provides tools**

Run from repo root:

```bash
nix-shell --run 'node -v && elixir -v && erl -eval "halt()." -noshell'
```

Expected: Node `v22.x.x`, Elixir `1.14+` (e.g. 1.18.x), Erlang starts and exits 0. Stderr/stdout may include the two `hint:` lines if deps are missing — that is correct.

- [ ] **Step 3: Commit**

```bash
git add shell.nix
git commit -m "$(cat <<'EOF'
Add shell.nix with Node 22 and Elixir for NixOS.

EOF
)"
```

---

### Task 2: Flake wrapper

**Files:**
- Create: `flake.nix`
- Test: `nix develop --command ...` (and optionally `nix flake check` if defined)

**Interfaces:**
- Consumes: `./shell.nix` via `pkgs.callPackage`
- Produces: `devShells.<system>.default` for `nix develop` / `use flake`

- [ ] **Step 1: Create `flake.nix`**

Pin a current nixpkgs branch that provides `nodejs_22` and Elixir ≥ 1.14. On NixOS 26.05 hosts, `nixos-unstable` or `nixos-26.05` both work; use `nixos-unstable` for broader package freshness unless the repo prefers a stable channel.

```nix
{
  description = "Alchemist — Elixir tool registry + Cursor agent adapter";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.callPackage ./shell.nix { inherit pkgs; };
        }
      );
    };
}
```

- [ ] **Step 2: Verify flake shell**

```bash
nix develop --command bash -lc 'node -v && elixir -v'
```

Expected: same version floors as Task 1. First run may lock `flake.lock` — that file should be committed.

- [ ] **Step 3: Commit**

```bash
git add flake.nix flake.lock
git commit -m "$(cat <<'EOF'
Add flake.nix wrapping the shared shell.nix.

EOF
)"
```

---

### Task 3: direnv + gitignore

**Files:**
- Create: `.envrc`
- Modify: `.gitignore` (append `.direnv/`)
- Test: `direnv allow` then confirm `node`/`elixir` on PATH in a new shell

**Interfaces:**
- Consumes: Task 1 `shell.nix`, Task 2 `flake.nix`
- Produces: automatic shell load on `cd`

- [ ] **Step 1: Create `.envrc`**

```bash
if ! use flake; then
  use nix
fi
```

- [ ] **Step 2: Append `.direnv/` to `.gitignore`**

Current `.gitignore` ends with runtime fetch ignores. Append:

```
.direnv/
```

Full resulting file should be:

```
node_modules
.env
.env.local
.agent-serve
memory
runtime/_build
runtime/deps
runtime/.fetch
.direnv/
```

- [ ] **Step 3: Allow and verify**

```bash
direnv allow
# in a fresh interactive shell, or:
eval "$(direnv export bash)"
command -v node
command -v elixir
node -v
elixir -v
```

Expected: paths under the Nix store (or direnv-managed env); versions meet floors. If flakes fail, `use nix` fallback should still work.

- [ ] **Step 4: Commit**

```bash
git add .envrc .gitignore
git commit -m "$(cat <<'EOF'
Add direnv config with flake-then-nix fallback.

EOF
)"
```

---

### Task 4: README Nix / NixOS section

**Files:**
- Modify: `README.md` (Prerequisites section, after the existing bullet list / before or after the mix bootstrap block)
- Test: visual/read-through only

**Interfaces:**
- Consumes: files from Tasks 1–3
- Produces: documented NixOS entry path

- [ ] **Step 1: Insert README subsection**

In `README.md`, under `## Prerequisites`, after the existing Node/Elixir bullets and before the `mix local.hex` code block is fine; prefer placing a dedicated subsection **after** the mix bootstrap block so non-Nix users see the universal steps first. Insert:

```markdown
### Nix / NixOS

Optional. Provides Node 22 and Elixir via a shared `shell.nix` (flake wraps the same shell).

1. Install [direnv](https://direnv.net/) (and preferably [nix-direnv](https://github.com/nix-community/nix-direnv) for caching).
2. Enable flakes if you want the primary path (`nix develop` / `use flake`); classic `nix-shell` still works without flakes.
3. From the repo root: `direnv allow`.
4. Run the mix/npm steps above if the shell prints `hint:` reminders.

Non-Nix users can ignore `flake.nix`, `shell.nix`, and `.envrc`.
```

Keep the existing Prerequisites bullets and mix/npm blocks unchanged.

- [ ] **Step 2: Skim README for consistency**

Confirm Prerequisites still lists Node 22.13+ and Elixir 1.14+, and the new subsection does not claim auto-install of deps.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Document Nix/direnv setup in the README.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Shared `shell.nix` with nodejs_22, elixir, erlang | Task 1 |
| Reminder-only `shellHook` | Task 1 |
| `flake.nix` via `callPackage ./shell.nix` | Task 2 |
| `.envrc` flake then nix | Task 3 |
| `.direnv/` in `.gitignore` | Task 3 |
| README Nix / NixOS under Prerequisites | Task 4 |
| No auto npm/mix install | Tasks 1, 4 |
| Non-Nix path unchanged | Task 4 |
