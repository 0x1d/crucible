---
id: crucible/alchemist/host-cursor/design/context-growth-fixes
title: Context Growth Fixes
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/host-cursor/design]
related: [crucible/alchemist/host-cursor/design/context-growth]
planned:
  - id: crucible/alchemist/host-cursor/P-03
    title: Context growth fixes
    depends: []
---

# Context Growth Fixes

**Planned** P-03.

Status: Accepted for implementation (2026-11-04); policy revised same day for SDK-first layering.

Supplements [cursor host context](context-growth.md),
[context handoff design](context-handoff.md), and
[prompt cache design](prompt-cache.md).

## Problem

The Cursor agent store is append-only. Digests and a shorter always-on prompt
slow growth; they do not shrink an existing continuation. Footer `ctx` is the
**last turn's prompt size** (`contextTokens` in `tui/adapters/cursor.ts`), not
proof that history was pruned. A drop in the meter (e.g. 37k -> 13k) is usually
`ctx` vs `new`, or disjoint vs gross-inclusive cache accounting - not compaction.

When `ctx` is yellow/red (>=150k / >=200k), the only **live** shrink on the
alchemist Cursor serve/HTTP path today is handoff into a **new** agent store
(`handoffFork`). This session measured ~284k.

SDK surfaces already expose better levers on some hosts; alchemist should prefer
those and keep its own tools as fallback - not invent a second compact path when
the SDK can do the job.

## Goals

1. Prefer each host SDK's native compact and tool-rewrite APIs when available.
2. Keep alchemist `handoff` / `handoffFork` and `resultDigest` as portable fallbacks.
3. Stop models from adding needless discovery turns when the slug is known.
4. Make handoff usable without a manual flag flip (until summarize is wired).
5. Keep large tool blobs out of new turns.
6. Make multi-turn prefix reuse reliable when operators want it (`pinnedModel`).
7. Document footer fields so operators do not misread cache math as prune.

## Non-goals

- Replacing SDK compact with a custom summarizer when the SDK already has one.
- Turning `defaultMaxBytes` on by default (low leverage while digests stay on).
- Changing the 200k window constant.
- Treating a falling `ctx` without handoff/summarize as proof of prune.

## Two layers (do not collapse)

| Layer | Job | When it runs |
| --- | --- | --- |
| **Emit-time tool shrink** | Keep large tool payloads out of the transcript | Every tool result |
| **History reclaim** | Shrink or replace an already-fat continuation | Yellow/red ctx, compact ask, or SDK auto threshold |

Emit-time shrink does not reclaim past turns. History reclaim does not replace
per-tool caps. Use both.

## Policy: SDK first, alchemist fallback

| Layer | Prefer (SDK) | Fallback (alchemist) |
| --- | --- | --- |
| Emit-time tool shrink | Claude: `PostToolUse` -> `updatedToolOutput` | `resultDigest` (Cursor serve has no rewrite hook) |
| History reclaim | Cursor: `@cursor/sdk` `agent.summarize()`; Claude: autocompact | `handoff` + `handoffFork` |

### Emit-time (D5 / D8)

- **Claude host:** Wire a `PostToolUse` hook that sets `updatedToolOutput` to the
  digested/capped payload (same presentation rules as Cursor `presentResult`).
  Prefer that over a second alchemist-side digest on the Claude path.
- **Cursor host:** Keep `resultDigest` **on**. The grok HTTP `/v1/session` path
  does not expose a PostToolUse-style rewrite; digest at `call_function` emit is
  the correct lever.
- `resultDigest` is not "Cursor-only forever" - it is the fallback whenever the
  SDK cannot rewrite tool output before it enters history.

### History reclaim (D2 / D3 / D7)

- **Prefer SDK compact** when the runtime can call it:
  - Cursor local Agent API: `agent.summarize()` (CLI `/summarize` equivalent).
  - Claude Agent SDK: built-in autocompact (plus PreCompact/PostCompact hooks).
- **Fallback:** `handoff` writes `handoff.md`; `handoffFork` starts a new agent
  store so the fat continuation is no longer live. Keep handoff even after
  summarize is wired: portable across hosts, works when summarize fails or is
  unavailable on cloud / HTTP paths.
- **Today (Cursor alchemist serve):** `@grok/agent-sdk` does **not** expose
  `agent.summarize()` on `/v1/session`. In-place compact stays deferred until
  that API is requested/wired. Until then, handoff + fork remain the only live
  shrink; defaults stay **on** so compact asks work without a flag flip.
- Do **not** auto-handoff as the primary strategy once summarize/autocompact is
  reachable - use SDK compact first, handoff/fork as fallback.

## Decisions

| Id | Choice | Rationale |
| --- | --- | --- |
| D1 Known slug | Always-on: if slug is known from table, skill, or this turn's `find_function`, `call_function` once - no second find, no `detail: true` for call args | Weather-style turns burned schemas + find + detail before one call |
| D2 `handoffTool` default | **on** (fallback path) | Compact asks failed with "disabled"; needed until summarize is on the serve path |
| D3 `handoffFork` default | **on** (fallback path) | Handoff without fork leaves the fat continuation token alive |
| D4 `pinnedModel` default | stays **off**; ops enable via `/flags` or env | Product-visible model pin; gate already exists when on |
| D5 `resultDigest` | stays **on** for Cursor; Claude prefers `updatedToolOutput` | Highest measured lever where SDK rewrite is missing |
| D6 Footer docs | State explicitly: `ctx` = full prompt; `new` = uncached slice; shrink without handoff/summarize is a display/accounting effect | Prevents false prune stories |
| D7 History reclaim | SDK summarize / autocompact first; handoff+fork fallback | Avoid duplicating SDK compact; keep portable escape hatch |
| D8 Tool rewrite | Claude `updatedToolOutput` first; `resultDigest` fallback | Same presentation goal; pick the API the host can actually call |
| D9 Exclusive reclaim | `historyReclaim`: host SDK mode (`summarize` on Cursor, `autocompact` on Claude) \| `handoffFork` \| `off` (one active) | Do not run SDK reclaim and handoff-fork together; SDK mode names stay host-specific |

## Always-on policy (D1)

Add under Codex tools / discover rules:

- Known slug -> one `call_function`. Skip `find_function` and MCP schema digs when
  the host already exposed the tool schema this turn or the slug is in the need table.
- `find_function` with `detail: true` only when editing that entry or the slim hit
  lacks required args.

## Host flag defaults (D2-D5)

Update `DEFAULT_HOST_FLAGS` in `hosts/cursor/bot/lib/host-flags.ts`:

```ts
handoffTool: true,
handoffFork: true,
```

Existing `host-flags.json` on disk wins over defaults until edited. Document in
the progress plan that a one-time `/flags` or file edit may be needed on long-lived
state roots.

## Observability (D6)

`docs/guides/tui.md` Footer section: one paragraph that a falling `ctx` without
handoff (or SDK summarize) does not mean the store pruned tool results.

## Capability matrix

| Host path | Emit-time | History reclaim (live) |
| --- | --- | --- |
| Cursor via `@grok/agent-sdk` HTTP serve | `resultDigest` | handoff + `handoffFork` only |
| Cursor `@cursor/sdk` Agent API (local) | (host-dependent) | `agent.summarize()` available; not wired through grok serve yet |
| Claude `@anthropic-ai/claude-agent-sdk` | Wire `updatedToolOutput`; no digest required once hooked | Autocompact; alchemist handoff optional fallback |

## Future work (D7 / D8)

1. Request or wire `@grok/agent-sdk` exposure of Cursor `agent.summarize()` (or
   equivalent) on the HTTP session path; TUI/compact ask should call it before
   forking.
2. Claude host: add `PostToolUse` digest via `updatedToolOutput`; optionally
   expose handoff as fallback only.
3. When summarize is live on Cursor serve, keep handoff defaults on but treat
   fork as fallback after summarize failure or operator force.

## Acceptance

| Check | Pass |
| --- | --- |
| Spec states SDK-first / alchemist-fallback for both layers | text present |
| `instructions.md` states known-slug one-shot call | text present |
| `DEFAULT_HOST_FLAGS.handoffTool` / `handoffFork` are `true` | unit test / defaults object |
| `docs/guides/tui.md` clarifies ctx vs new / no silent prune | text present |
| `npm run test:hosts` (or targeted host-flags + prompt-stability) | pass |
| Live: compact ask writes `handoff.md` without enabling flags first | after serve restart |
| Claude `updatedToolOutput` / Cursor summarize via grok | deferred until wired |

## Out of band

Prefix-cache quality remains gated by `pinnedModel` + `prompt-cache/pong` eval;
enable in deploy configs that care about follow-up cost, not as a silent default
in this change.

## Implementation plan

Spec: [context growth fixes](context-growth-fixes.md).

Policy: **SDK first, alchemist fallback** - two layers (emit-time tool shrink vs history reclaim).

### Tasks

1. Spec (done) - SDK-first layering in `docs/internal/specs/2026-11-04-context-growth-fixes.md`
2. `instructions.md` known-slug one-shot (done)
3. `DEFAULT_HOST_FLAGS` handoffTool + handoffFork on (done)
4. `docs/guides/tui.md` ctx vs new / no silent prune (done)
5. Progress matrix + host-flags unit test (done)
6. `node --test hosts/cursor/bot/lib/host-flags.test.ts` + `npm run check:docs`
7. Restart serve / TUI so flag defaults apply; compact ask should write `handoff.md`
8. Include `package-lock.json` follow-redirects 1.16.1 -> 1.16.2 (transitive; `package.json` unchanged)
9. Optional deploy: enable `pinnedModel` for prefix-cache gate (not default)

### Next (SDK wiring)

1. Cursor serve: request/wire `@grok/agent-sdk` exposure of `agent.summarize()`; compact ask prefers summarize, then handoff+fork
2. Claude host: prefer `PostToolUse` -> `updatedToolOutput` over emit-time digest (digest wired as interim fallback)
3. After summarize is reachable: do not auto-handoff as primary; keep handoffFork reclaim as fallback

### Done (2026-11-04 follow-up)

- Exclusive `historyReclaim` with host-specific SDK modes: Cursor `summarize` | `handoffFork` | `off`; Claude `autocompact` | `handoffFork` | `off` (Claude defaults autocompact; Cursor handoffFork)
- Derived `autoSummarize` (Cursor) / `autoCompact` (Claude); cross-host toggles rejected
- Claude host reads shared host flags (`resultDigest`, `defaultMaxBytes`, reclaim, ...) from `hosts/claude/.agent-serve/`
- `/flags reclaim <mode>` in TUI; reclaim boolean toggles stay exclusive aliases
- Dropped legacy `/ctx` alias, `ALCHEMIST_CTX_*` env, and `context-improvements.json` fallback

### Deferred

- In-place history replace on Cursor HTTP path (blocked on grok summarize exposure)
- Claude handoff tool (optional once autocompact + updatedToolOutput are enough)
- `defaultMaxBytes` default on

## Progress

Tracks work from [cursor host context](context-growth.md),
[context handoff](context-handoff.md),
[prompt cache](prompt-cache.md), and
[context growth fixes](context-growth-fixes.md) (SDK-first
summarize/autocompact/`updatedToolOutput`; alchemist handoff/fork + `resultDigest`
as fallback).

Toggle host flags with `/flags` in the TUI (uses the **active host** state root) or edit
`hosts/<host>/.agent-serve/host-flags.json`.
Serve-side flags apply on the next `serve()` start (restart the TUI or `/host`).

**History reclaim is exclusive** via `historyReclaim`. Modes are host-specific:
Cursor `summarize` | `handoffFork` | `off`; Claude `autocompact` | `handoffFork` | `off`.
Only one mechanism is active. `/flags reclaim <mode>` (or `/flags on autoSummarize` /
`autoCompact` / `handoffFork`) switches it. Cursor defaults to `handoffFork`; Claude defaults to `autocompact`.
Derived booleans `handoffTool` / `handoffFork` / `autoSummarize` / `autoCompact` stay in sync.

Eval overrides use `ALCHEMIST_HOST_FLAG_<SNAKE_CASE>` (`hostFlagEnvKey()` in `hosts/cursor/bot/lib/host-flags.ts`).
`ALCHEMIST_HOST_FLAG_HISTORY_RECLAIM=<mode>` sets the exclusive reclaim mode.

### Improvement matrix

| Id | Source item | Default | Effect on context window |
| --- | --- | --- | --- |
| `resultDigest` | section 1 bridge cap / digest | on | Shrinks large `call_function` results in the transcript; baseline named-read ~25.7k vs uncapped read ~119k. |
| `defaultMaxBytes` | section 6 default caps | off | Injects `max_bytes` on `fs.read` / `http.get`; lowers per-turn blobs; may hide tail unless user reads `path`. |
| `pinnedModel` | prompt-cache design | off | Pins server default to `composer-2.5` at `reasoning_effort=high` (no `fast`); follow-up cache read should approach full prompt (eval gate). TUI `/model` overrides are ignored while this is on. |
| `historyReclaim` | growth fixes + host exclusivity | Cursor: `handoffFork`; Claude: `autocompact` | Exclusive reclaim: host SDK mode **or** handoff+fork **or** off. |
| `handoffTool` / `handoffFork` | handoff design; growth fixes | derived from `historyReclaim` | Expose `handoff` + TUI fork only when mode is `handoffFork`. |
| `autoSummarize` | Cursor SDK summarize | derived from `historyReclaim` | Cursor reclaim mode `summarize` (wire `agent.summarize()` when grok exposes it). |
| `autoCompact` | Claude Agent SDK | derived from `historyReclaim` | Claude `settings.autoCompactEnabled` when mode is `autocompact`. |
| `toolResultLog` | section 7 observability | off | Logs largest tool results per turn to `.agent-serve/context-tool-sizes.log`. |

Already shipped without a flag (measured in the host-context plan):

- Named-path one-shot `fs.read` rule in `instructions.md`.
- Known-slug one-shot `call_function` rule in `instructions.md` (2026-11-04).
- Shorter always-on prompt (`bot/skills/*`).
- `docker.ps_report` summary, array/string digests in `call_function`.
- Footer cached/read/write/new split (`tui/view.ts`); guide clarifies `ctx` vs `new` (no silent prune).

### Verification log

Branch `feat/tui` at `93e2162` (2026-11-03, Europe/Zurich).
BEAM evals and `node scripts/cli.mjs` need `nix develop` (Elixir on `PATH`).
Plain shell without nix still passes token-budget gates but fails tool-output checks with `spawn elixir ENOENT`.

| Check | Status | Notes |
| --- | --- | --- |
| `git pull origin feat/tui` | pass | fast-forward `93232e1..93e2162` |
| `npm run check` | pass | types + docs |
| `npm run test:tui` | pass | 79 tests |
| `node --test` (context + handoff libs) | pass | 13 tests (handoff, context-improvements, prompt-stability, `/ctx`) |
| `npm run test:hosts` | partial | 16/17; cursor `instructions.md` has no `### Examples` (shorter prompt); claude examples pass in nix |
| `nix develop -- node scripts/cli.mjs ... echo` | pass | `ok:true`, `echoed:true` |
| `npx @grok/agent-sdk validate --dir hosts/cursor` | pass | |
| `npm run eval:cursor -- smoke` | pass | 9.8s; artifacts `.../evals/2026-11-03T15-00-28-442Z` |
| `nix develop -- npm run eval:cursor -- context-size` | pass | 4/4; artifacts `.../evals/2026-11-03T15-01-42-338Z` |
| `nix develop -- ALCHEMIST_CTX_HANDOFF_TOOL=1 npm run eval:cursor -- handoff/compact` | pass | writes `handoff.md`; gate on tool output; `inputTokens~21608` |
| `nix develop -- ALCHEMIST_CTX_PINNED_MODEL=1 npm run eval:cursor -- prompt-cache/pong` | pass | `prompt1=6575`, `cache2=6592` (>= prompt1-1k) |
| `npm run test` (nix develop) | pass | runtime 28 + functions 32 + node suites; cursor instructions examples skipped (no `### Examples`) |
| `npm run eval:cursor -- memory` | pass | |
| `npm run eval:cursor -- memory-time` | pass | 3/3 |
| `node scripts/measure-call-function.mjs` (digest A/B) | pass | digest on **1782** B vs off **144150** B; off + `DEFAULT_MAX_BYTES` **66609** B |
| `npm run eval:cursor -- context-size` (no nix) | fail | 0/4; reply gates fail on `spawn elixir ENOENT` |

### Measurements

Baseline from [cursor host context](context-growth.md) (2026-11-03, gate evals):

| Improvement | Input tokens (named read gate) | Effect |
| --- | --- | --- |
| Search-before-read (reverted path) | 62,802 fail | Extra tools inflate prompt |
| One-shot named `fs.read` | 29,426 pass (earlier) | -33k vs search path |
| Shorter instructions / skills | 25,743 pass (earlier) | -3k |
| `call_function` digest (32k cap + array/string digest) | large read 21,548; docker list 14,447 (2026-11-03 nix run) | Stops multi-100k tool blobs in transcript |
| `defaultMaxBytes` (flag, 65536) | not re-run live | Caps read/http bodies per turn when on |
| `pinnedModel` + follow-up | prompt-cache eval pass | `cache2=6784` vs `prompt1=6819` (gate: cache2 >= prompt1-1k) |
| `handoffTool` + compact ask | handoff/compact pass | `inputTokens=21636` (gate <=32k named-read budget) |
| `handoffFork` | unit tests only | TUI fork path covered by `tui/adapters/handoff.test.ts`; no live over-200k fork eval yet |

### Effectiveness (2026-11-03, nix develop)

| Lever | Measurement | Verdict |
| --- | --- | --- |
| **Always-on prompt** (named read, one-shot `fs.read`) | `context-size/named-read` **26-27k** input vs search-before-read **62.8k** (historical fail) | **High** - keeps gate under 32k |
| **`resultDigest` (default on)** | Tool output **1.8kB** vs **144kB** off; eval `large-read` **~21.5k** tokens on vs **59.9k** off (6 tools, budget fail) | **High** - ~81x smaller tool blob; prevents runaway turns when off |
| **`defaultMaxBytes` alone** | With digest on, `large-read` **~21.6k** (same as baseline); with digest off, **148k** tokens and 13 tools (worse than digest-only off) | **Low alone** when digest stays on; **partial** as safety net when digest off (**66kB** tool payload vs **144kB**) |
| **`handoffTool`** | Disabled: model may still call `handoff` (error). Enabled: **802 B** `handoff.md`, same turn budget as named read | **Medium** - compaction path works; eval now requires successful write |
| **`pinnedModel` + cache** | Turn 2 **cache read ~ full prompt** (`6592` read vs `6575` prompt1) | **High** for multi-turn cost/latency when flag on |
| **`toolResultLog`** | Not re-run (needs `ALCHEMIST_CTX_TOOL_RESULT_LOG=1` on serve) | Observability only |
| **`handoffFork`** | Not live-tested | Design: fork to a new session (old transcript retained); `tui/adapters/handoff.test.ts` only - see below |

Env override naming: camelCase ids map to `ALCHEMIST_HOST_FLAG_SNAKE_CASE` (see header). Wrong names silently leave defaults.

Latest `context-size` gate metrics (2026-11-03, `93e2162`, nix develop):

| Case | inputTokens | cacheRead | newTokens |
| --- | --- | --- | --- |
| named-read | 26,867 | 14,464 | 12,403 |
| large-read | 21,548 | 16,768 | 4,780 |
| docker-report | 14,668 | 9,728 | 4,940 |
| structured-list | 14,447 | 9,728 | 4,719 |

Toggle comparison: `/flags list`, `/flags off resultDigest` (restart TUI), then
`ALCHEMIST_HOST_FLAG_RESULT_DIGEST=0 npm run eval:cursor -- context-size/large-read`
vs default (digest on). Deterministic tool sizing:
`nix develop -- node scripts/measure-call-function.mjs`.
