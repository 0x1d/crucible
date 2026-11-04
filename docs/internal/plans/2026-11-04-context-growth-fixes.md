---
title: Context growth fixes plan
description: Implement known-slug policy, handoff defaults, footer docs, and SDK-first compact layering from the 2026-11-04 spec.
project: alchemist
tags: [cursor, claude, context, plan]
---

# Context growth fixes — plan

Spec: [context growth fixes](../specs/2026-11-04-context-growth-fixes.md).

Policy: **SDK first, alchemist fallback** — two layers (emit-time tool shrink vs history reclaim).

## Tasks

1. Spec (done) — SDK-first layering in `docs/internal/specs/2026-11-04-context-growth-fixes.md`
2. `instructions.md` known-slug one-shot (done)
3. `DEFAULT_HOST_FLAGS` handoffTool + handoffFork on (done)
4. `docs/guides/tui.md` ctx vs new / no silent prune (done)
5. Progress matrix + host-flags unit test (done)
6. `node --test hosts/cursor/bot/lib/host-flags.test.ts` + `npm run check:docs`
7. Restart serve / TUI so flag defaults apply; compact ask should write `handoff.md`
8. Include `package-lock.json` follow-redirects 1.16.1 → 1.16.2 (transitive; `package.json` unchanged)
9. Optional deploy: enable `pinnedModel` for prefix-cache gate (not default)

## Next (SDK wiring)

1. Cursor serve: request/wire `@grok/agent-sdk` exposure of `agent.summarize()`; compact ask prefers summarize, then handoff+fork
2. Claude host: prefer `PostToolUse` → `updatedToolOutput` over emit-time digest (digest wired as interim fallback)
3. After summarize is reachable: do not auto-handoff as primary; keep handoffFork reclaim as fallback

## Done (2026-11-04 follow-up)

- Exclusive `historyReclaim` with host-specific SDK modes: Cursor `summarize` | `handoffFork` | `off`; Claude `autocompact` | `handoffFork` | `off` (Claude defaults autocompact; Cursor handoffFork)
- Derived `autoSummarize` (Cursor) / `autoCompact` (Claude); cross-host toggles rejected
- Claude host reads shared host flags (`resultDigest`, `defaultMaxBytes`, reclaim, …) from `hosts/claude/.agent-serve/`
- `/flags reclaim <mode>` in TUI; reclaim boolean toggles stay exclusive aliases
- Dropped legacy `/ctx` alias, `ALCHEMIST_CTX_*` env, and `context-improvements.json` fallback

## Deferred

- In-place history replace on Cursor HTTP path (blocked on grok summarize exposure)
- Claude handoff tool (optional once autocompact + updatedToolOutput are enough)
- `defaultMaxBytes` default on
