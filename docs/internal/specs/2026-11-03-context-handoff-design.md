---
title: Context handoff design
description: Design for shrinking a Cursor host session by writing a handoff file and opening a new agent store.
project: alchemist
tags: [tui, cursor, context, handoff, design]
---

# Context handoff design

Status: Proposed.

This design merges the handoff tool with the route that actually drops the transcript.
A cache hit leaves every token in the window.
The running session is an append-only agent store, and this SDK has no call that replaces that store.
The shrink is a new session whose first message is a short file plus the user text.
Reusing the prefix of a session that is still inside the window is the [prompt cache design](2026-11-03-prompt-cache-design.md).

## Goal

When a Cursor TUI session's last prompt is over the 200,000-token window, the next user message is answered in a new agent store.
The new prompt is the fixed host base, `handoff.md` (at most 12,000 bytes), and that user message.
The old transcript stays on the old continuation token and is not sent again.
A user who asks to compact below the window gets the same fork on the following message.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Where the file is written | `hosts/cursor/bot/tools/handoff.ts` | Server tool. The model knows the working set. `defineAgent` stays `tools: ["mcp"]`. |
| Where the fork happens | `CursorAdapter.send` in `tui/adapters/cursor.ts` | The adapter holds the continuation token. The model cannot drop it. |
| Automatic threshold | Last turn `contextTokens` greater than 200,000 | `tui/theme.ts` paints that prompt red. Yellow starts at 150,000 and does not fork by itself. |
| Who sees the ratio | The adapter, from `turn.completed` usage | The model does not see the footer. |
| Seed | Preamble, the file, the held user text | The new store has no prior tool results. |
| Same-session summary | Not used | Writing the file into the current store adds a tool result. |
| `instructions.md` | No new line in the first cut | One always-on line raised the named-read case from 25,699 to 25,811 input tokens and was reverted. |
| Claude host | Unchanged | This SDK path is the Cursor host. |
| Playground and `agent-sdk run` | Unchanged | Those clients keep the continuation token. Only the TUI adapter forks. |
| Result digest | Unchanged | `call_function` already stores a large result and returns a digest. The context-size budgets stay the gate that the base has not grown. |

## Tool

| | |
| --- | --- |
| Name | `handoff` |
| File | `hosts/cursor/bot/tools/handoff.ts` |
| Render | `hosts/cursor/bot/lib/handoff.ts` |
| Effect | `write` |
| Surface | Discovered server tool, advertised beside the MCP allowlist |

The tool writes a file and a pointer.
It does not compose the assistant reply.
It does not call `memory.remember`, `ctx.host.files`, or `ctx.send`.

### Arguments

One closed object.
Unknown keys are rejected.

| Field | Required | Bound | What it is |
| --- | --- | --- | --- |
| `files` | no | 0–40 strings, each 1–240 characters | Touched paths |
| `systems` | no | 0–20 strings, each 1–120 characters | Touched systems |
| `pitfalls` | no | 0–12 strings, each 1–400 characters | Pitfalls |
| `state` | yes | 1–2,000 characters | Current state of the work |
| `next` | yes | 1–12 strings, each 1–400 characters | Next steps |
| `facts` | no | 0–12 strings, each 1–400 characters | Any other fact required to continue |

There is no markdown body and no free-text summary field.
`renderHandoff` builds the file from these fields.
Empty `files`, `systems`, `pitfalls`, and `facts` omit their sections.
`State` and `Next` are always present.

```markdown
# Handoff

## State
<state>

## Next
- <next item>

## Files
- <path>

## Systems
- <system>

## Pitfalls
- <pitfall>

## Facts
- <fact>
```

`renderHandoff` returns the UTF-8 text.
The text is at most 12,000 bytes.
Over that cap it throws `Error` with the message `handoff.md would be N bytes, over the 12000 byte cap.`
The tool writes nothing when render throws.

### Return

The file is `handoff.md` in the session workspace (`ctx.workspaceDir`, `hosts/cursor/.sessions/<id>/`).

```json
{ "path": "handoff.md", "bytes": 0, "confirmation": "Wrote handoff.md (0 bytes)." }
```

`bytes` is the UTF-8 length of the file.
`confirmation` is `Wrote handoff.md (N bytes).` with that length.
The return has no section body.

### Pointer

After the file is on disk, the same call puts `{ "path": "handoff.md", "bytes": N }` at `ctx.host.kv` key `handoff/<sessionId>`.
The value has those two fields and no summary body.
The adapter reads the workspace file.
The kv key is an index for another session, and the harness does not query MiniGraf to find the file.

A call with no `ctx.session.id` returns the three fields and does not put the key.
The CLI scratch workspace is the one `agent-sdk tool call` already removes.

A second call overwrites `handoff.md` and the same kv key.

### Dry run

`effect: "write"` means a dry-run session does not run `execute`.
`dryRunResult` calls `renderHandoff` and returns the same three fields with confirmation `Dry run. handoff.md was not written.`
`bytes` is the rendered length.
An over-cap input throws the same error.
Nothing is written and the kv key is not put.

### When the model calls it

The tool description is this text:

```text
Write handoff.md for a new session. Call when the user asks to compact, or says the context footer is yellow or red. Then stop. Do not mention /new.
```

The description is the only always-on copy.
`/new` is a TUI command (`openSession(undefined)` in `tui/main.ts`).
The reply does not tell the user to run it.

## Adapter

Pure decisions live in `tui/adapters/handoff.ts`.
`CursorAdapter` calls them.
The stream loop reads the raw `action.result` event.
`mapCursorEvent` drops `toolName`, so the mapped `tool_result` is not the signal.

### Constants

```text
HANDOFF_REQUEST
The context window is full. Call the handoff tool with the working set, then stop. Do not answer the user in this session.

HANDOFF_PREAMBLE
Continue this work from the handoff below. The prior transcript is not in this session.

FORK_ABOVE_TOKENS
200000
```

`seedMessage(file, userText)` is the preamble, a blank line, the file with one trailing newline removed, a blank line, and the user text.

### Route

`routeTurn` picks one route from the open session, the last prompt size, a pending handoff, and the file text.

| Session | Last `contextTokens` | Pending handoff | File on disk | Route |
| --- | --- | --- | --- | --- |
| no | any | no |  | `create` with the user text |
| yes | 200,000 or below | no |  | `follow-up` with the user text |
| yes | 200,000 or below | yes | present | `fork` with `seedMessage` |
| yes | 200,000 or below | yes | missing | `error`, pending stays set |
| yes | above 200,000 | no |  | `compact-then-fork` |
| yes | above 200,000 | yes | present | `fork` with `seedMessage` |
| yes | above 200,000 | yes | missing | `error`, pending stays set |

Yellow (150,000 through 200,000) uses the follow-up row.
The user can still ask to compact, and the tool description covers that ask.

`compact-then-fork` posts `HANDOFF_REQUEST` to the old session.
The user text is not in that body.
`send` does not yield that turn's text, reasoning, or tool events.
A successful handoff is raw `action.result` with `toolName` `handoff`, `isError` false, and `stubbed` not true.
On that result the adapter reads `hosts/cursor/.sessions/<oldId>/handoff.md` and `POST /v1/session` with `seedMessage(file, userText)`.
The new session's events are the ones `send` yields.
A compact turn that ends without that result yields `{ type: "error", message: "The context window is full and handoff did not complete. The message was not sent." }`
The user text is not posted to either store.
The old continuation token stays, and the next send tries `compact-then-fork` again.

`fork` does not post to the old session.
The create body is `createBody(seed, model, effort)` plus `title` set to the old session title.
A 400 that names `title` is retried once without `title`.
The response `sessionId` and `continuationToken` replace the adapter's.
`nextIndex` restarts at 0.
The model and effort are the picker values `create` already sends.

A pending handoff is set when a normal turn's raw `action.result` matches the success rule above.
That turn already carried the user text, and it stays large.
The following send takes the `fork` row.
`openSession` of that same id, before the fork, sees the successful `action.result` in the event log and sets pending again.

`openSession(undefined)` and a model change that already detaches the session clear the pending flag and the stored `contextTokens`.
`contextTokens` is the last `turn.completed` usage, passed through `contextTokens()` in `tui/adapters/cursor.ts`.

### Session chain

`GET /v1/sessions` has no parent field.
On a successful fork the adapter records `{ "<oldId>": "<newId>" }` in `<stateRoot>/handoff-chain.json`.
`stateRoot` is `hosts/cursor/.agent-serve`.
The file holds session ids only.

`resolveSuccessor` follows those edges, at most 20 steps, and returns the last id.
`listSessions` omits every id that is a key in the chain.
`openSession` of a predecessor opens the latest successor and replays that successor.
The live transcript is not cleared.
`/new` clears the open session.
A restart shows the successor transcript, which starts at the handoff seed, under the same title when the create accepted `title`.

The old continuation token still replays the full transcript.
The SDK has no call that truncates it.

```text
user message, last prompt over 200000
    → follow-up is HANDOFF_REQUEST only
        → handoff.md + kv pointer on the old session
            → POST /v1/session
                → first message is the preamble, the file, and the user text

user message, user asked to compact, prompt at or under 200000
    → model calls handoff on that turn
        → next user message
            → POST /v1/session with the preamble, the file, and that next message
```

## Checks

These fail when the window does not shrink or when the tool contract drifts.
An `agent-sdk eval` follow-up keeps the continuation token, so no eval asserts the fork.
The fork is locked in `node --test`.

### Render and route, no model

`node --test hosts/cursor/bot/lib/handoff.test.ts`

- The rendered sections follow the template, and empty optional sections are absent.
- `bytes` of a known input equals `Buffer.byteLength` of the text.
- A render over 12,000 bytes throws the cap error and the test writes no file.

`node --test tui/adapters/handoff.test.ts`

- Each row of the route table returns that kind.
- `seedMessage` equals the preamble, a blank line, the file, a blank line, and the user text.
- `HANDOFF_REQUEST` does not contain the user text.
- A successful `action.result` sets pending, and `stubbed: true` or `isError: true` does not.
- `resolveSuccessor` walks a two-edge chain to the last id and stops at 20 steps.

### Tool contract, no model

```bash
agent-sdk tool call handoff --dir hosts/cursor --input '<json>' --json
```

- `path` is `handoff.md`.
- `bytes` equals the rendered UTF-8 length.
- `confirmation` is `Wrote handoff.md (N bytes).`
- The result has no section body.
- An unknown key, an empty `state`, or an empty `next` is `invalid_tool_input`, and nothing is written.
- `--dry-run --json` returns confirmation `Dry run. handoff.md was not written.` and does not leave `handoff.md` behind.

`agent-sdk validate --dir hosts/cursor` passes.
`npx tsc --noEmit` passes.
`npm run test:tui` and `npm run test:hosts` pass.

### Prompt base, model turn

`agent-sdk eval --dir hosts/cursor context-size/named-read`

The case stays at or under `NAMED_READ_INPUT_TOKEN_BUDGET` (32,000).
The budget is not raised.
A miss means the tool description or schema is shortened, then the case is run again.
`context-size/large-read`, `context-size/docker-report`, and `context-size/structured-list` stay at their existing budgets.

### Compact ask, model turn

`hosts/cursor/evals/handoff.eval.ts`, case id `handoff/compact`.

The prompt is `Compact the context.`
The turn calls `handoff`.
The reply does not contain `/new`.
Input tokens are at or under 32,000.
The case does not send a second message.

If this case calls some other tool and never calls `handoff`, one line is added beside the tool list in `hosts/cursor/bot/instructions.md`.
That line is kept only when `context-size/named-read` still passes 32,000.

## Out of scope

- Shrinking the turn that calls `handoff`.
- A host API that replaces history inside the current continuation token.
- Copying the handoff body into MiniGraf.
- Changing `call_function`'s digest, `docker.ps`, `docker.ps_report`, or `docker.overview`.
- Forking the Claude host, the playground, or `agent-sdk run`.
- Footer colors and the cached/new split. Those already match `docs/guides/tui.md`.
