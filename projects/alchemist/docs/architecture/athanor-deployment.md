---
id: crucible/alchemist/architecture/athanor-deployment
title: athanor Deployment
type: ARCH
owner: crucible/alchemist
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/architecture]
related: []
planned:
  - id: crucible/alchemist/P-01
    title: Codex overlay, repository sync and sidecar hardening for athanor
    depends: []
---

# athanor Deployment

**Planned** P-01.

**Date:** 2026-11-10
**Counterpart:** athanor plans `007_access-control`, `008_agent-sandbox`, `009_free-tier-deployment`.

## Problem

The athanor host assumes a single machine: one `functions/` tree that is also alchemist's own source, a sidecar on `127.0.0.1` without auth, and a service gateway athanor reaches over loopback.
In the deployment, the sidecar and BEAM run in a short-lived Vercel Sandbox, athanor runs elsewhere, and the agent's work must outlive the sandbox.

## Decisions

- Agent-written codex entries and athanor components live in a separate **codex repo**, not in alchemist.
- Alchemist does the git work for that repo: on start, after turns that changed something, and on request.
- The memory graph is saved and restored by athanor's controller from outside the sandbox (athanor plan 008 slice 5). Alchemist only needs `AGENT_MEMORY_PATH`, which already exists.

## Codex repo layout

```
components/        athanor components (.nsh.tsx, .wasm)
functions/         agent-written entries: services/<name>/, anything else defined
services.json      published services manifest
README.md
```

## Slices

### 1. Functions overlay

`Runtime.Codex` has one root (`functions_root/0`). Add a second, writable one.

- `AGENT_CODEX_DIR`: the overlay root (`<checkout>/functions`). Unset means today's single-root behavior.
- Lookup (`load`, `find`, `call`, `list_all`): overlay first, then the base root.
- `define` writes to the overlay when it is set.
- `define` of a slug that exists in the base root is refused (`slug is a built-in entry`); built-ins are changed in alchemist, not shadowed.
- `functions/lib` (shared modules for `Runtime.Compiler`) comes from the base root only.
- `Runtime.CodexWarmup` compiles both trees.
- `Runtime.ServiceGateway` takes its `functions_root` from the overlay when set (services are agent-written), and its manifest from `ALCHEMIST_SERVICE_MANIFEST` (pointed at `<checkout>/services.json`).
- `codex.uncommitted_report` / `codex.commit_uncommitted` default `repo` and `functions_rel` to the overlay's checkout when set.

### 2. `codex.sync`

An entry in alchemist (`functions/codex/sync/`), so the agent, the sidecar and a user can all run it.

- Args: `{ "reason": "start" | "turn" | "publish" | "user", "session_id"? }`.
- Config: `CODEX_REPO` (`owner/name`), `CODEX_GITHUB_TOKEN`, `CODEX_CHECKOUT` (default `<state dir>/codex`).
- **First run**: clone into `CODEX_CHECKOUT` (shallow); empty repo -> write the layout and a README. Git auth through a credential helper reading `CODEX_GITHUB_TOKEN` from the environment; the token is never written to `.git/config`.
- **Each run**:
  1. `git pull --rebase`.
  2. Three-way sync of `components/**` and `services.json` with athanor's working copy, through the athanor API with `NSHDE_AGENT_API_TOKEN` (`GET /api/codex/files`, `GET/POST /api/storage`, `POST /api/codex/base`). Rules in athanor plan 008: one side changed -> copy to the other; both changed -> keep athanor's, write the repo's as `<name>.remote.<ext>` in athanor, report a conflict; delete on one side with the other unchanged -> delete.
  3. Stage `functions/**`, `components/**`, `services.json`.
  4. Nothing staged -> `{ ok, changed: [] }`.
  5. Commit `codex: <summary>`; body lists changed components and entries, the reason, and `source-session` when given. Author `Alchemist <alchemist@users.noreply.github.com>` unless `CODEX_GIT_AUTHOR` is set.
  6. `git push`; on rejection pull and retry once, then fail with the git error.
- Returns `{ ok, commit?, changed, conflicts }`.
- `AgentLib.Nshde` gains the `/api/codex/*` calls.

### 3. Sidecar

`hosts/nshde/sidecar.ts`:

- **Auth**: every request needs `Authorization: Bearer <NSHDE_SIDECAR_TOKEN>` when the variable is set; required when `NSHDE_SIDECAR_HOST` is not loopback (refuse to start otherwise). `timingSafeEqual`.
- **Startup**: when `CODEX_REPO` is set, run `codex.sync` with `reason: "start"` before listening, so the first turn sees the repo. `GET /health` answers once that is done.
- **Turn end**: after `done`, if `codex.uncommitted_report` (or `git status` in the checkout) shows changes, or a component was written, run `codex.sync` with `reason: "turn"` and emit a `sync` event (`{ commit, changed, conflicts }`) before closing the stream.
- **`POST /sync`**: runs `codex.sync` with the given reason; for athanor's **Sync** button and publish.
- **`POST /services/:name`**: forwards the JSON body to the local `Runtime.ServiceGateway` with the framed `call` op, answers the gateway's JSON. For athanor service calls from outside the sandbox.
- **Outbound**: `AgentLib.Nshde` sends `Authorization: Bearer <NSHDE_AGENT_API_TOKEN>` on every request when the variable is set.

### 4. Docs

- `hosts/nshde/README.md`: variables (`NSHDE_SIDECAR_TOKEN`, `NSHDE_AGENT_API_TOKEN`, `AGENT_CODEX_DIR`, `CODEX_*`), the new routes and the `sync` event, the overlay rule.
- `docs/security.md`: the sidecar is exposed beyond loopback only with the token; `CODEX_GITHUB_TOKEN` is reachable by agent-defined code, so scope it to the codex repo.
- `docs/architecture.md`: base and overlay roots.

## Tests

- Overlay: lookup order; `define` writes to the overlay; shadowing a built-in is refused; `lib` from the base only; warmup compiles both.
- `codex.sync` against a local bare repo and a fake athanor API: clone/init, each three-way case, nothing to commit, push rejected then retried, token absent from `.git/config`.
- Sidecar: 401 without token; refuses a non-loopback host without a token; start sync before listening; turn-end sync emits `sync`; `/services/:name` forwards and returns gateway errors.

## Done when

- With `AGENT_CODEX_DIR` and `CODEX_REPO` set, a turn that defines a service and writes a component ends with one commit in the codex repo containing both.
- A fresh sidecar on a new machine clones the repo and can call that service.
- Without the new variables, alchemist behaves as today.
