---
title: Context growth fixes
description: SDK-first shrink (summarize, autocompact, updatedToolOutput) with alchemist handoff/fork and resultDigest as fallbacks.
project: alchemist
tags: [cursor, claude, context, handoff, sdk, design]
---

# Context growth fixes

Status: Accepted for implementation (2026-11-04); policy revised same day for SDK-first layering.

Supplements [cursor host context](../plans/2026-11-03-cursor-host-context.md),
[context handoff design](2026-11-03-context-handoff-design.md), and
[prompt cache design](2026-11-03-prompt-cache-design.md).

## Problem

The Cursor agent store is append-only. Digests and a shorter always-on prompt
slow growth; they do not shrink an existing continuation. Footer `ctx` is the
**last turn's prompt size** (`contextTokens` in `tui/adapters/cursor.ts`), not
proof that history was pruned. A drop in the meter (e.g. 37k → 13k) is usually
`ctx` vs `new`, or disjoint vs gross-inclusive cache accounting—not compaction.

When `ctx` is yellow/red (≥150k / ≥200k), the only **live** shrink on the
alchemist Cursor serve/HTTP path today is handoff into a **new** agent store
(`handoffFork`). This session measured ~284k.

SDK surfaces already expose better levers on some hosts; alchemist should prefer
those and keep its own tools as fallback—not invent a second compact path when
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
| Emit-time tool shrink | Claude: `PostToolUse` → `updatedToolOutput` | `resultDigest` (Cursor serve has no rewrite hook) |
| History reclaim | Cursor: `@cursor/sdk` `agent.summarize()`; Claude: autocompact | `handoff` + `handoffFork` |

### Emit-time (D5 / D8)

- **Claude host:** Wire a `PostToolUse` hook that sets `updatedToolOutput` to the
  digested/capped payload (same presentation rules as Cursor `presentResult`).
  Prefer that over a second alchemist-side digest on the Claude path.
- **Cursor host:** Keep `resultDigest` **on**. The grok HTTP `/v1/session` path
  does not expose a PostToolUse-style rewrite; digest at `call_function` emit is
  the correct lever.
- `resultDigest` is not “Cursor-only forever”—it is the fallback whenever the
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
  reachable—use SDK compact first, handoff/fork as fallback.

## Decisions

| Id | Choice | Rationale |
| --- | --- | --- |
| D1 Known slug | Always-on: if slug is known from table, skill, or this turn's `find_function`, `call_function` once—no second find, no `detail: true` for call args | Weather-style turns burned schemas + find + detail before one call |
| D2 `handoffTool` default | **on** (fallback path) | Compact asks failed with “disabled”; needed until summarize is on the serve path |
| D3 `handoffFork` default | **on** (fallback path) | Handoff without fork leaves the fat continuation token alive |
| D4 `pinnedModel` default | stays **off**; ops enable via `/flags` or env | Product-visible model pin; gate already exists when on |
| D5 `resultDigest` | stays **on** for Cursor; Claude prefers `updatedToolOutput` | Highest measured lever where SDK rewrite is missing |
| D6 Footer docs | State explicitly: `ctx` = full prompt; `new` = uncached slice; shrink without handoff/summarize is a display/accounting effect | Prevents false prune stories |
| D7 History reclaim | SDK summarize / autocompact first; handoff+fork fallback | Avoid duplicating SDK compact; keep portable escape hatch |
| D8 Tool rewrite | Claude `updatedToolOutput` first; `resultDigest` fallback | Same presentation goal; pick the API the host can actually call |
| D9 Exclusive reclaim | `historyReclaim`: host SDK mode (`summarize` on Cursor, `autocompact` on Claude) \| `handoffFork` \| `off` (one active) | Do not run SDK reclaim and handoff-fork together; SDK mode names stay host-specific |

## Always-on policy (D1)

Add under Codex tools / discover rules:

- Known slug → one `call_function`. Skip `find_function` and MCP schema digs when
  the host already exposed the tool schema this turn or the slug is in the need table.
- `find_function` with `detail: true` only when editing that entry or the slim hit
  lacks required args.

## Host flag defaults (D2–D5)

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
