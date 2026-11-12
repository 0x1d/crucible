---
id: crucible/alchemist/host-cursor/design/context-enforcement
title: Context Enforcement
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/host-cursor/design]
related: []
planned:
  - id: crucible/alchemist/host-cursor/P-04
    title: Context enforcement
    depends: []
---

# Context Enforcement

**Planned** P-04.

**Date:** 2026-11-04  
**Context:** HTTP session `ses_30597a504cc1b110d69da5f0` hit a full context window (~188k on a wasteful "status" turn). Repo was clean on `feat/find-describe-split`. This document is the **full proposal** for the next enforcement slice; it supersedes informal handoff bullets only where they conflict.

**Related:**

- [Cursor host context (2026-11-03)](context-growth.md)
- [Context improvements progress](context-growth-fixes.md)
- [Context growth fixes spec](context-growth-fixes.md)
- [Context handoff design](context-handoff.md)

**Memory (MiniGraf):**

| Entity | Role |
| --- | --- |
| `decision/minimal-status-probe` | Status turns: `memory.overview`, optional `handoff.md` read, `git status -sb` + `git log --oneline ~8` via small stdout - not long docs or fat `git.log` JSON |
| `constraint/avoid-fat-tool-results` | Avoid codex `git.log` and similar when oneline git via `sys.cmd` suffices |
| `constraint/no-exploration-spiral` | No parallel exploratory listing/transcripts for simple factual questions |
| `preference/align-with-context-pr` | Model slim find, small reads, minimal calls when this plan applies |

---

## 1. Problem statement

### 1.1 Two layers (unchanged policy)

| Layer | Mechanism today | Gap |
| --- | --- | --- |
| **Emit-time tool shrink** | `resultDigest` wraps **`call_function` only** (`hosts/cursor/bot/tools/call_function.ts` -> `presentResult`) | `find_function`, `define_function`, and `load_function` return raw JSON into the agent store |
| **History reclaim** | Cursor: `handoffFork` (defaults on); SDK `summarize` not wired on HTTP serve | Does not remove fat results already in the continuation |

Emit-time gaps let a single turn bypass the bridge cap:

- **`find_function` with `detail: true`** - full moduledoc + specs for one slug (large).
- **`git.log` via `call_function`** - default `numstat: true`, `limit: 20`, full bodies and per-file lists (188k-class turns when combined with parallel discovery).
- **`define_function` / `load_function`** - compile output and errors can be large.

### 1.2 Flag mismatch

- `defaultHostFlags`: `resultDigest: true`, **`defaultMaxBytes: false`** (`hosts/cursor/bot/lib/host-flags.ts`).
- `call_function` already injects `max_bytes: 65536` for `fs.read` / `http.get` **when** `defaultMaxBytes` is on.
- Spec [context growth fixes](context-growth-fixes.md) deferred turning `defaultMaxBytes` on by default ("low leverage while digests stay on"). **This proposal revisits that** for defense-in-depth once all MCP codex tools share digest + documented caps.

### 1.3 Prompt vs enforcement (`instructions.md` ~6.95 KB)

Rules in `hosts/cursor/bot/instructions.md` are **not** automatically enforced. Mapping:

| Rule (prompt) | Enforced today | Proposal |
| --- | --- | --- |
| Named path -> one `fs.read` | No (model policy) | Keep prompt; eval `context-size/named-read` gates regression |
| Known slug -> one `call_function` | No | Keep prompt |
| Slim `find_function` (no `detail` for discovery) | Partially (Engine slim search) | Digest on find; cap `detail` payload size at host |
| Avoid fat git history | No | **`git.log` defaults** + prompt points to `sys.cmd` / future `git.log_oneline` |
| `truncated: true` -> use head/tail | No | Digest already on `call_function` |
| Memory schema / skill on demand | No | Shrink Memory section after skill is sufficient |
| Minimal status probe | No (memory fact only) | Optional `memory.remember` of `handoff.md` path; agent reads fact before status turns |

**Goal:** Move **caps and digests into the host and codex defaults** so `instructions.md` can shrink without losing safety.

---

## 2. Goals and non-goals

### Goals

1. Apply the same **result digest pipeline** to all four MCP codex tools (at minimum `find_function`; consistently `define` / `load` where output is JSON).
2. Set **`defaultMaxBytes: true`** in `defaultHostFlags` (with eval re-run and note in progress doc).
3. Make **`git.log` agent-safe by default** (`numstat` off, lower default `limit`, or add **`git.log_oneline`**).
4. **Shrink `instructions.md`** after (1)-(3): duplicate tables -> skills/docs; keep one-line pointers.
5. Preserve **context-size eval budgets**; extend gates if new tools need them.

### Non-goals

- Replacing `handoffFork` with in-place summarize on Cursor HTTP (still blocked on grok SDK).
- Digesting **native** Cursor tools (MCP-only host).
- Changing `FILE_BODY_INLINE_MAX` / digest thresholds without remeasuring evals.
- Auto-injecting MiniGraf facts into the prompt (operators/agents still `memory.query`).

---

## 3. Proposed work

### 3.1 Shared MCP result cap (Phase A - host)

**Extract** `capResult` from `call_function.ts` into e.g. `hosts/cursor/bot/lib/cap-tool-result.ts`:

```ts
export async function capToolResult(
  result: ToolExecuteResult,
  ctx: { toolCallId?: string; workspaceDir: string },
  toolLabel: string,
): Promise<ToolExecuteResult>
```

Behavior unchanged:

- Respect `resolveHostFlags().resultDigest`.
- `logToolResultSize(toolLabel, result, flags.toolResultLog)`.
- Write full JSON to `artifacts/<id>.json`; return digest via `presentResult`.

**Wire** into:

| Tool file | `toolLabel` |
| --- | --- |
| `tools/call_function.ts` | slug name |
| `tools/find_function.ts` | `find_function` |
| `tools/define_function.ts` | `define_function` |
| `tools/load_function.ts` | `load_function` |

**Acceptance:**

- Unit tests: mock large find result -> truncated digest + artifact path.
- `pnpm run eval:cursor -- context-size` still passes (add **`find_function` gate** if a synthetic large `detail: true` response exceeds budget - see section 5).

**Pitfall:** `find_function` search hits are usually small; **`detail: true`** is the main find risk. Digest must apply to describe responses from `Engine.find_describe/1` (`runtime/lib/runtime/engine.ex`).

### 3.2 `defaultMaxBytes` default true (Phase B - host flags)

**Change** in `defaultHostFlags()`:

```ts
defaultMaxBytes: true,
```

**Document** in [context improvements progress](context-growth-fixes.md):

- Existing `host-flags.json` with `false` wins until edited.
- Re-run `measure-call-function.mjs` and `context-size/large-read` (expect ~same when digest on; benefit is defense when digest off or partial failure).

**Revise** one line in [context growth fixes spec](context-growth-fixes.md) non-goals: default on **after** MCP-wide digest (this proposal).

### 3.3 `git.log` agent-safe defaults (Phase C - codex)

**Option A (preferred, minimal surface):** Change defaults in `functions/git/log/tool.ex`:

| Arg | Today | Proposed |
| --- | --- | --- |
| `numstat` | default **true** | default **false** |
| `limit` | 20 (max 500) | **8** default for agents (keep max 500 for explicit callers) |

Update `@moduledoc` to warn that full numstat + high limit is for human/CI analytics, not agent status turns.

**Option B (clearer API):** New entry `git.log_oneline`:

- Wraps `git log --oneline -n N` via `sys.cmd` or thin git argv.
- Returns `{ "lines": ["abc1234 subject", ...] }` only.
- `instructions.md` need table: "Recent commits (agent)" -> `git.log_oneline` or `sys.cmd`.

**Option C (status turns):** Document in memory + one prompt line: never `git.log` for status; use `sys.cmd` with `["git","log","--oneline","-8"]`.

**Recommendation:** **A + C** immediately; **B** if evals or operators want a typed slug without raw argv.

**Tests:** `functions/git/log` tests for new defaults; runtime test that argv omits `--numstat` when unset.

### 3.4 `sys.cmd` stdout cap (Phase D - optional)

Large stdout from `sys.cmd` still enters history undigested when invoked **through** `call_function` (digest applies to the **whole** tool result object - usually OK). If stdout is a giant string inside `{ ok, result: { stdout } }`, existing `presentResult` should digest it.

**Verify** with a fixture; if gap, ensure string digest path covers top-level `stdout` in codex maps.

### 3.5 Shrink `instructions.md` (Phase E - after A-C)

Remove or shorten sections once enforced:

| Section | Action |
| --- | --- |
| Memory attribute list | Keep 5-line table + "examples in memory skill" (already partially done) |
| Codex tools table | Keep; single row note "host digests large tool JSON" |
| Efficient tool use | Move PR/composition detail to `codex` skill only (trim duplicate bullets) |
| Git row in need table | Add "recent commits: oneline via sys.cmd or git.log_oneline; not full git.log" |

**Target:** ~5-5.5 KB always-on prompt without losing eval `named-read` <= 32k (remeasure after each cut).

### 3.6 Handoff + memory path (Phase F - optional)

Operational pattern from [cursor host context section 5](context-growth.md):

1. `handoff` tool or manual `handoff.md` in session workspace.
2. `memory.remember` with `description` = path + one line (no body in graph).
3. New session: `memory.query` / overview -> `fs.read` path.

**Optional product work:** Codex helper `session.handoff_read` or document in `memory` skill. **Not required** for enforcement slice.

---

## 4. `feat/find-describe-split` alignment

Engine already splits:

- `find_search/2` - slim hits (name, summary, `@spec`).
- `find_describe/1` - full metadata when `detail: true` and exact slug.

Host enforcement must treat **describe** as a first-class large payload. Prompt rules already say: never `detail` during discovery. **Host digest** is the backstop when the model disobeys.

---

## 5. Verification plan

| Check | Command / artifact | Pass criterion |
| --- | --- | --- |
| Host flags default | `node --test hosts/cursor/bot/lib/host-flags.test.ts` | `defaultMaxBytes === true` |
| Digest on find | New unit test in `cap-tool-result` or tool test | Large find JSON -> `truncated: true` |
| Context gates | `nix develop -- pnpm run eval:cursor -- context-size` | All cases <= budgets in host-context plan |
| Named read | same | <= 32,000 input tokens |
| Git defaults | `mix test` in `functions/git/log` | No `--numstat` by default; limit 8 |
| Instructions size | `wc -c hosts/cursor/bot/instructions.md` | <= ~5500 after Phase E (guideline) |
| Docs | `pnpm run check:docs` | pass |

**New eval (recommended):** `context-size/find-detail` - one `find_function` with `detail: true` on a large entry; assert input tokens <= **28,000** (align with memory search gate) and tool result digested.

---

## 6. Rollout order

```mermaid
flowchart LR
  A[Extract capToolResult] --> B[Wire find define load]
  B --> C[defaultMaxBytes true]
  C --> D[git.log defaults]
  D --> E[Evals + progress doc]
  E --> F[Shrink instructions.md]
```

1. **Phase A** - shared cap + tests (no default flag change).
2. **Phase B** - `defaultMaxBytes` default true + remeasure.
3. **Phase C** - `git.log` defaults (+ optional `git.log_oneline`).
4. **Phase E** - prompt shrink only after gates green.
5. **Phase F** - handoff/memory docs optional.

Restart Cursor serve / TUI after flag default change so new sessions pick up defaults; document for existing `host-flags.json`.

---

## 7. Pitfalls (from handoff)

1. **Digest only on `call_function` today** - fat `git.log` or `find` detail still blows the window until Phase A.
2. **`defaultMaxBytes` false by default** - `fs.read` / `http.get` return full bodies unless args set or flag on.
3. **Memory facts not injected** - agents must query `decision/minimal-status-probe` before status-style turns; storing this proposal in repo docs does not replace that.
4. **Parallel git status pattern** - user rules ask for parallel `git status` / `git diff` / `git log` for **commits**; for **agent status** in this host, prefer minimal probe per memory decision (conflict resolved: user commit rule applies when user asks to commit; minimal probe for "what's the state").
5. **Handoff does not shrink current continuation** - only fork/new session; file is compact working set.
6. **Always-on line cost** - any new `instructions.md` line must pass `named-read` eval (handoff design: +112 tokens reverted once).

---

## 8. File touch list

| Path | Change |
| --- | --- |
| `hosts/cursor/bot/lib/cap-tool-result.ts` | **new** - shared digest wrapper |
| `hosts/cursor/bot/tools/call_function.ts` | use shared cap |
| `hosts/cursor/bot/tools/find_function.ts` | use shared cap |
| `hosts/cursor/bot/tools/define_function.ts` | use shared cap |
| `hosts/cursor/bot/tools/load_function.ts` | use shared cap |
| `hosts/cursor/bot/lib/host-flags.ts` | `defaultMaxBytes: true` |
| `hosts/cursor/bot/lib/host-flags.test.ts` | assert new default |
| `functions/git/log/tool.ex` | numstat/limit defaults |
| `functions/git/log/*_test.exs` | default argv tests |
| `hosts/cursor/bot/instructions.md` | shrink Phase E; git oneline hint |
| `hosts/cursor/evals/context-size.eval.ts` | optional find-detail case |
| `docs/host-cursor/design/context-growth-fixes.md` | matrix + verification row |
| `docs/host-cursor/design/context-growth-fixes.md` | revise defaultMaxBytes non-goal note |
| `runtime/lib/runtime/engine.ex` | no change required for split; verify describe payload size in tests |

---

## 9. Acceptance summary

This proposal is **done** when:

- [x] All MCP codex tool handlers run through `capToolResult` when `resultDigest` is on.
- [x] `defaultMaxBytes` defaults to true in code and tests.
- [x] `git.log` no longer defaults to numstat + 20 commits for agent-shaped calls.
- [ ] `context-size` eval suite passes under nix.
- [ ] Progress doc and this proposal's status updated to **implemented** (or checklist per phase).
- [ ] `instructions.md` reduced without named-read regression.

---

## 10. Decision log

| Id | Decision | Rationale |
| --- | --- | --- |
| E1 | Digest all MCP codex tools, not only `call_function` | Same transcript store; find/detail and define errors bypassed cap |
| E2 | Flip `defaultMaxBytes` after MCP digest | Defense in depth; spec deferral overridden with measurement |
| E3 | `git.log` numstat off, limit 8 | Matches minimal-status-probe; fat JSON is primary leak |
| E4 | Prefer codex default change over more prompt text | Prompt-only rules failed on 188k turn |
| E5 | Optional `git.log_oneline` deferred to Phase C feedback | Option A may suffice |

---

*Stored from handoff session `ses_d8a72f81933359f918ddf9ee` (continuation of `ses_30597a504cc1b110d69da5f0`).*
