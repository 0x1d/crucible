---
id: crucible/alchemist/host-cursor/design/prompt-cache
title: Prompt Cache
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/host-cursor/design]
related: []
planned:
  - id: crucible/alchemist/host-cursor/P-02
    title: Prompt cache
    depends: []
---

# Prompt Cache

**Planned** P-02.

Status: Proposed.

This design sits beside the [context handoff design](context-handoff.md).
Handoff opens a new store when the prompt is over 200,000 tokens.
This design makes a follow-up inside the window reuse the prefix already sent.

## Measured gap

Same prompt, empty git workspace, model left on Auto.
The CLI prints `inputTokens` after subtracting cache read and cache write.
The host `inputTokens` already include the cache when that number is at least the cache read.
The prompt size below is the sum the model was given.

| Run | Prompt | Cache read | New |
| --- | --- | --- | --- |
| CLI, first turn | 13,292 | 3,968 | 9,324 |
| CLI, follow-up | 13,444 | 13,184 | 260 |
| Host, first turn | 6,816 | 2,944 | 3,872 |
| Host, follow-up | 6,902 | 512 | 6,390 |

The host follow-up resumed the same agent 1.7 seconds later (`ses_5638f53ea8a04d2c9e41b977`).
The prompt grew by 86 tokens and the cache read fell from 2,944 to 512.
`cacheWriteTokens` was 0 on the CLI turn that the next turn still hit, so that field is not the signal.
The signal is the next turn's cache read.

The host base is already smaller than the CLI base.
The session workspace is its own git root and does not inherit the user skill layer.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Default model | `grok-4.7` with `reasoning_effort=high` and `fast=true` | Auto is the route whose follow-up cache read fell to 512. These params are the ones `modelConfig("grok-4.7", "high")` already sends. |
| Where it is set | `hosts/cursor/bot/model.ts`, used by `defineAgent` | `agent-sdk run`, evals, and a TUI create that omits `modelConfig` all use `agent.ts`. |
| Follow-up body | `{ continuationToken, message }` only | A later model change misses the prefix. `followUpBody` already omits `modelConfig`. |
| Picker entry `auto` | Stays available | A session created with `auto` is outside this gate. The server default is the pin. |
| `settingSources` | SDK default `["project"]` | The user skill layer is the CLI's extra size. `defineAgent` has no field for it. |
| `local.cwd` | `.sessions` | Each session workspace stays its own git root. |
| Footer | Full prompt, plus cached and new | The CLI's printed `inputTokens` is the uncached slice. The footer keeps the window visible. |
| Workspace-scan TTL | Unchanged | The measured miss was 1.7 seconds. |
| Summarizer | Unchanged | This SDK has no `SummarizeAction`. The handoff design is that path. |

## Pinned model

`hosts/cursor/bot/model.ts` exports this value.

```ts
export const PINNED_MODEL = {
  id: "grok-4.7",
  params: [
    { id: "reasoning_effort", value: "high" },
    { id: "fast", value: "true" },
  ],
};
```

`defineAgent({ model: PINNED_MODEL })` replaces `model: "auto"`.
`modelConfig("grok-4.7", "high")` returns `{ model: PINNED_MODEL }`.
A TUI create that names `grok-4.7` at effort `high` sends that same object.
A create that names another id or another effort sends that choice, and the cache gate does not cover it.

## Stable prefix bytes

`hosts/cursor/bot/instructions.md` and the description strings in `hosts/cursor/bot/tools/*.ts` are static files.
They contain no clock, no session id, and no footer ratio.
A test reads those files and fails on `Date.now`, `new Date`, or a template slot `${`.

## Gate

`hosts/cursor/evals/prompt-cache.eval.ts`, case id `prompt-cache/pong`.

The first message is `Reply with exactly the word pong and nothing else.`
The second message is `Reply with exactly the word pong2 and nothing else.`
Both turns succeed.
Neither turn calls a tool.
Prompt size is `contextTokens()` from `tui/adapters/cursor.ts` applied to that turn's `turn.completed` usage.
Cache read is `cacheReadTokens`.

| Check | Pass |
| --- | --- |
| First prompt | `prompt1` <= 16,000 |
| Second prompt | `prompt2` <= 16,000 |
| Second prompt growth | `prompt2` <= `prompt1` + 1,000 |
| Second cache read | `cache2` >= `prompt1` - 1,000 |

The recorded host miss is `cache2` 512 against `prompt1` 6,816, and it fails the last row.
The CLI follow-up, 13,184 cached against a 13,292 prompt, passes it.
The case records `prompt1`, `prompt2`, `cache1`, and `cache2` with `t.metric`.
The ceilings are not raised to make a miss pass.
The default model is not put back on `auto` to make a miss pass.

A miss with the pin left in place means the local agent rebuilt the prefix.
That rebuild is in `@cursor/sdk`.
This repository does not set cache breakpoints.

## Public docs

`docs/architecture/host-adapters.md` states that the Cursor host default model is `grok-4.7` with those two params, and that a follow-up keeps the model stored at create.
`docs/guides/tui.md` states that a Cursor session with no model selected runs that default, and that `auto` is a picker choice.

## Out of scope

- The handoff tool, the fork, and shrinking a prompt that is already over 200,000 tokens.
- Printing the uncached slice as the context total.
- Loading `~/.cursor/skills` into this host.
- `CURSOR_RIPWALK_CACHE_TTL_MS` and `workspaceScanCacheTtlMs`.
- A call to the CLI summarizer.
- Putting `elixir` on `PATH`. A missing runtime is a failed tool result, and it still occupies the store.

## Implementation plan

Status: Proposed.

Spec: [Prompt cache design](prompt-cache.md).

The context handoff plan is a separate change.
This plan pins the model and locks the follow-up cache read.
Each task's check must pass before the next task starts.

### Files

| File | Responsibility |
| --- | --- |
| `hosts/cursor/bot/model.ts` | `PINNED_MODEL` |
| `hosts/cursor/bot/agent.ts` | `defineAgent({ model: PINNED_MODEL })` |
| `hosts/cursor/bot/prompt-stability.test.ts` | Static instructions and tool descriptions |
| `tui/adapters/cursor.ts` | `modelConfig("grok-4.7", "high")` returns the pin |
| `tui/adapters/cursor.test.ts` | That equality |
| `hosts/cursor/evals/prompt-cache.eval.ts` | Two-turn cache gate |
| `docs/architecture/host-adapters.md` | Default model sentence |
| `docs/guides/tui.md` | Default model and the `auto` picker choice |

`followUpBody` stays `{ continuationToken, message }`.
`local.cwd` stays `.sessions`.
The footer math stays on the full prompt.

### Task 1: Pin

Create `hosts/cursor/bot/model.ts` with the object in the spec.
Point `defineAgent` at it.
In `modelConfig`, when the id is `grok-4.7` and the effort is `high`, return `{ model: PINNED_MODEL }`.
Other ids and efforts keep the params they already build.

```bash
npm run test:tui
npx tsc --noEmit
node_modules/.bin/agent-sdk validate --dir hosts/cursor
```

Pass: the existing `modelConfig("grok-4.7", "high")` assertion still passes, `tsc` exits 0, and validate exits 0.

### Task 2: Static prefix files

Add `hosts/cursor/bot/prompt-stability.test.ts`.
It reads `hosts/cursor/bot/instructions.md` and every `hosts/cursor/bot/tools/*.ts`.
It fails when a file contains `Date.now`, `new Date`, or `${`.

```bash
npm run test:hosts
```

Pass: the new test passes.

### Task 3: Cache gate

Add `hosts/cursor/evals/prompt-cache.eval.ts` as the spec's case `prompt-cache/pong`.
Use `contextTokens` from `tui/adapters/cursor.ts` for the prompt size.
Record the four metrics.
Do not send a model override in the eval. The server default is the pin.

```bash
node_modules/.bin/agent-sdk eval --dir hosts/cursor prompt-cache/pong
```

Pass: the case passes, including `cache2` >= `prompt1` - 1,000.
On a miss, leave `PINNED_MODEL` in place and keep the eval.
Do not edit the ceilings.
Do not set the default model back to `auto`.
A missing Cursor credential stops this command.
Tasks 1 and 2 still stand.
This command is the gate that the follow-up reuses the prefix.

### Task 4: Public guide

Add the two sentences from the spec to `docs/architecture/host-adapters.md` and `docs/guides/tui.md`.

```bash
npm run check:docs
```

Pass: the docs check exits 0.

### Done

The implementation is complete when tasks 1, 2, and 4 pass, and task 3 has been run with a Cursor credential and passes.
Task 3 is the gate.
A passing task 3 with a prompt still over 200,000 tokens is unchanged handoff work.
