# Prompt cache implementation plan

Status: Proposed.

Spec: [Prompt cache design](../specs/2026-11-03-prompt-cache-design.md).

The context handoff plan is a separate change.
This plan pins the model and locks the follow-up cache read.
Each task's check must pass before the next task starts.

## Files

| File | Responsibility |
| --- | --- |
| `hosts/cursor/bot/model.ts` | `PINNED_MODEL` |
| `hosts/cursor/bot/agent.ts` | `defineAgent({ model: PINNED_MODEL })` |
| `hosts/cursor/bot/prompt-stability.test.ts` | Static instructions and tool descriptions |
| `tui/adapters/cursor.ts` | `modelConfig("grok-4.7", "high")` returns the pin |
| `tui/adapters/cursor.test.ts` | That equality |
| `hosts/cursor/evals/prompt-cache.eval.ts` | Two-turn cache gate |
| `docs/reference/hosts.md` | Default model sentence |
| `docs/guides/tui.md` | Default model and the `auto` picker choice |

`followUpBody` stays `{ continuationToken, message }`.
`local.cwd` stays `.sessions`.
The footer math stays on the full prompt.

## Task 1: Pin

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

## Task 2: Static prefix files

Add `hosts/cursor/bot/prompt-stability.test.ts`.
It reads `hosts/cursor/bot/instructions.md` and every `hosts/cursor/bot/tools/*.ts`.
It fails when a file contains `Date.now`, `new Date`, or `${`.

```bash
npm run test:hosts
```

Pass: the new test passes.

## Task 3: Cache gate

Add `hosts/cursor/evals/prompt-cache.eval.ts` as the spec's case `prompt-cache/pong`.
Use `contextTokens` from `tui/adapters/cursor.ts` for the prompt size.
Record the four metrics.
Do not send a model override in the eval. The server default is the pin.

```bash
node_modules/.bin/agent-sdk eval --dir hosts/cursor prompt-cache/pong
```

Pass: the case passes, including `cache2` ≥ `prompt1` − 1,000.
On a miss, leave `PINNED_MODEL` in place and keep the eval.
Do not edit the ceilings.
Do not set the default model back to `auto`.
A missing Cursor credential stops this command.
Tasks 1 and 2 still stand.
This command is the gate that the follow-up reuses the prefix.

## Task 4: Public guide

Add the two sentences from the spec to `docs/reference/hosts.md` and `docs/guides/tui.md`.

```bash
npm run check:docs
```

Pass: the docs check exits 0.

## Done

The implementation is complete when tasks 1, 2, and 4 pass, and task 3 has been run with a Cursor credential and passes.
Task 3 is the gate.
A passing task 3 with a prompt still over 200,000 tokens is unchanged handoff work.
