---
id: crucible/alchemist/host-cursor/design/prompt-cache
title: Prompt Cache
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-cursor/design, crucible/alchemist/host-cursor/design/host-flags]
related: [crucible/alchemist/host-cursor/decisions]
planned: []
---

# Prompt Cache

A follow-up on the Cursor host is cheap only when the model provider reuses the prefix it cached on the previous turn. The prefix stays reusable when the model does not change between turns and the always-on prompt bytes do not change. The host fixes the model when the serve process starts, can pin it to one known-good model with the `pinnedModel` flag, keeps the instructions and tool descriptions static, and checks the reuse with an eval. Shrinking a prompt that is already over the budget is the handoff's job ([crucible/alchemist/host-cursor/design/context-handoff](context-handoff.md)).

## 1 Agent model

`hosts/cursor/bot/agent.ts` calls `resolveAgentModel()` (`hosts/cursor/bot/lib/agent-model.ts`) once, when the serve host loads it:

| Condition | Model |
| --- | --- |
| `pinnedModel` is on | `PINNED_MODEL` from `hosts/cursor/bot/model.ts`: `composer-2.5` with `reasoning_effort: high`, without `fast` |
| `ALCHEMIST_TUI_MODEL_ID` is set and not `auto` | That id, with the effort from `ALCHEMIST_TUI_MODEL_EFFORT` (default `high`) |
| Otherwise | `auto` |

The TUI sets the two variables from the picked `sessionModel` before it starts the serve host. A picked `composer-2.5` at effort `high` is sent as `PINNED_MODEL` itself; any other choice is sent with its effort parameter (`reasoning` for `gpt` models, `reasoning_effort` otherwise) and `fast: true`. While `pinnedModel` is on, picker choices are ignored.

The SDK does not accept a model on a live `POST /v1/session`, so a model change takes effect only after the serve host restarts. A follow-up body is `{ continuationToken, message }` and never carries a model, because a model change would miss the cached prefix.

## 2 Static prefix

`hosts/cursor/bot/instructions.md` and the descriptions in `hosts/cursor/bot/tools/*.ts` contain no clock, session id or template slot. `hosts/cursor/bot/prompt-stability.test.ts` fails when one of those files contains `Date.now`, `new Date` or `${`.

Each session workspace is its own git root under `hosts/cursor/.sessions/`, so the repository's `AGENTS.md` and the user's skill layer do not enter the prefix; the SDK's `settingSources` default `["project"]` leaves the user layer off.

## 3 Gate

`hosts/cursor/evals/prompt-cache.eval.ts`, case `prompt-cache/pong`, sends `Reply with exactly the word pong and nothing else.` and then `... pong2 ...` in one session, without tools. Prompt size is `contextTokens()` of each `turn.completed`; cache read is `cacheReadTokens`.

| Check | Pass |
| --- | --- |
| First prompt | `prompt1` <= 16,000 |
| Second prompt | `prompt2` <= 16,000 and <= `prompt1` + 1,000 |
| Second cache read | `cache2` >= `prompt1` - 1,000 |

The case records `prompt1`, `prompt2`, `cache1` and `cache2`. It needs a Cursor credential and passes with `pinnedModel` on (crucible/alchemist/host-cursor/AD-05). A miss with the pin on means the SDK rebuilt the prefix; this repository sets no cache breakpoints.
