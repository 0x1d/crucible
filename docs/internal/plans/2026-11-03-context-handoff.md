# Context handoff implementation plan

Status: Proposed.

Spec: [Context handoff design](../specs/2026-11-03-context-handoff-design.md).

The design replaces [Handoff tool](2026-11-03-handoff-tool.md).
Implement the tasks in order.
Each task's check must pass before the next task starts.
A failing check is fixed in that task.
The named-read budget stays 32,000 input tokens.

## Files

| File | Responsibility |
| --- | --- |
| `hosts/cursor/bot/lib/handoff.ts` | `renderHandoff` and the 12,000-byte cap |
| `hosts/cursor/bot/lib/handoff.test.ts` | Render and cap |
| `hosts/cursor/bot/tools/handoff.ts` | Tool, workspace write, kv pointer, `dryRunResult` |
| `tui/adapters/handoff.ts` | Request text, seed, route table, chain walk, raw-event match |
| `tui/adapters/handoff.test.ts` | Route rows, seed, pending match, chain walk |
| `tui/adapters/cursor.ts` | Record usage, route `send`, chain file, session list and open |
| `tui/adapters/cursor.test.ts` | Existing usage tests stay; add the raw `action.result` match if it is not covered by `handoff.test.ts` |
| `hosts/cursor/evals/handoff.eval.ts` | One compact ask |
| `docs/guides/tui.md` | One footer paragraph for the fork |

`hosts/cursor/bot/agent.ts` stays `tools: ["mcp"]`.
`hosts/cursor/bot/instructions.md` stays unchanged unless task 6 fails the compact ask.

## Task 1: Render

Create `hosts/cursor/bot/lib/handoff.ts` and `handoff.test.ts` as the spec's template and cap.

```bash
node --test hosts/cursor/bot/lib/handoff.test.ts
```

Pass: the template test and the cap test pass.
The cap test does not create `handoff.md`.

## Task 2: Tool

Create `hosts/cursor/bot/tools/handoff.ts`.
`execute` calls `renderHandoff`, writes `handoff.md` under `ctx.workspaceDir`, then `ctx.host.kv.put("handoff/" + ctx.session.id, { path, bytes })` when `ctx.session.id` is present.
`dryRunResult` calls `renderHandoff` and returns the dry-run confirmation from the spec.
The description string is the spec's description, unchanged.

```bash
node --test hosts/cursor/bot/lib/handoff.test.ts
npx tsc --noEmit
node_modules/.bin/agent-sdk validate --dir hosts/cursor
```

Pass: validate exits 0.
`tsc` exits 0.

Then call the tool.
Use a temp state root so the repo state directory is untouched.

```bash
node_modules/.bin/agent-sdk tool call handoff --dir hosts/cursor --json --dry-run \
  --input '{"state":"Digest is on.","next":["Fork the next send."]}'
```

Pass: stdout is one JSON document, `confirmation` is `Dry run. handoff.md was not written.`, and `bytes` equals the rendered length.

```bash
node_modules/.bin/agent-sdk tool call handoff --dir hosts/cursor --json \
  --state-root /tmp/alchemist-handoff-tool \
  --input '{"state":"Digest is on.","next":["Fork the next send."]}'
```

Pass: `path` is `handoff.md`, `confirmation` is `Wrote handoff.md (N bytes).`, and `N` equals `bytes`.
The result has no `state` field.

```bash
node_modules/.bin/agent-sdk tool call handoff --dir hosts/cursor --json \
  --state-root /tmp/alchemist-handoff-tool \
  --input '{"state":"","next":["Fork the next send."]}'
```

Pass: exit is not 0, and the error code is `invalid_tool_input`.

```bash
node_modules/.bin/agent-sdk tool call handoff --dir hosts/cursor --json \
  --state-root /tmp/alchemist-handoff-tool \
  --input '{"state":"Digest is on.","next":["Fork the next send."],"extra":true}'
```

Pass: exit is not 0, and the error code is `invalid_tool_input`.

## Task 3: Route

Create `tui/adapters/handoff.ts` and `handoff.test.ts` for every row of the spec's route table, `seedMessage`, `HANDOFF_REQUEST`, the `action.result` match, and `resolveSuccessor`.

```bash
npm run test:tui
```

Pass: the new file passes, and the existing TUI tests still pass.

## Task 4: Wire the adapter

In `CursorAdapter.send`, replace the direct `followUp` / `create` choice with `routeTurn`.

- `create` uses the existing `create` path.
- `follow-up` uses the existing `followUp` path.
- `fork` calls `create` with `seedMessage` and the `title` retry from the spec, then appends one edge to `<stateRoot>/handoff-chain.json`.
- `compact-then-fork` calls `followUp` with `HANDOFF_REQUEST` only.
  The stream is consumed and not yielded.
  On a matching `action.result`, read `hosts/cursor/.sessions/<oldId>/handoff.md` and continue with the `fork` create.
  Otherwise yield the spec's error and leave the user text unsent.
- `error` yields the missing-file error and does not post.

Record `contextTokens` from each `turn.completed` usage event through the existing `contextTokens()` helper.
Set pending from the raw `action.result` rule.
`listSessions` drops chain keys.
`openSession` resolves a successor before it reads events, and it restores pending from that log.
`detachSession` clears pending and `contextTokens`.

```bash
npm run test:tui
npx tsc --noEmit
```

Pass: both exit 0.
Add a test in `tui/adapters/handoff.test.ts` if a route row has no assertion yet.
Do not start a live `serve` in these tests.

## Task 5: Prompt budget

The tool schema is now on every turn.
Re-measure before keeping the description.

```bash
node_modules/.bin/agent-sdk eval --dir hosts/cursor context-size/named-read
node_modules/.bin/agent-sdk eval --dir hosts/cursor context-size/large-read
node_modules/.bin/agent-sdk eval --dir hosts/cursor context-size/docker-report
node_modules/.bin/agent-sdk eval --dir hosts/cursor context-size/structured-list
```

Pass: each case passes its current budget in `hosts/cursor/evals/context-size.eval.ts`.
On a named-read miss, shorten the tool description or the field descriptions, then run `context-size/named-read` again.
Do not edit the budget constants.

A missing Cursor credential stops these four commands.
The earlier tasks still stand.
These four are the gate that keeps the tool.

## Task 6: Compact ask

Add `hosts/cursor/evals/handoff.eval.ts` with one case, id `handoff/compact`.
Prompt: `Compact the context.`
Gates: `t.succeeded()`, `t.calledTool("handoff")`, input tokens at or under 32,000, and the reply does not contain `/new`.
Do not call `t.send` a second time.

```bash
node_modules/.bin/agent-sdk eval --dir hosts/cursor handoff/compact
```

Pass: the case passes.
If `handoff` is not called, add one short line to `hosts/cursor/bot/instructions.md` beside the tool list, then run this case and `context-size/named-read` again.
Keep the line only when both pass.
Remove it when the named-read case goes over 32,000.

## Task 7: Public guide

Add one paragraph to the Footer section of `docs/guides/tui.md`.
State that a Cursor prompt over 200,000 tokens makes the next send write `handoff.md` on the current session and answer the user text in a new session.
State that a compact request at or under 200,000 tokens forks on the following message.
State that the old transcript stays on the old session.

```bash
npm run check:docs
```

Pass: the docs check exits 0.

## Done

The implementation is complete when tasks 1–4 and 7 pass, and tasks 5–6 have been run with a Cursor credential and pass.
Task 5 is the gate for the tool schema.
Task 6 is the gate for the model calling `handoff`.
The fork itself is task 3 and task 4.
