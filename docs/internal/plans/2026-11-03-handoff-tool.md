# Handoff tool

The Cursor host cannot compact the session that is already running.
`handoff` writes the working set to a file.
The next message in the TUI starts a new agent store whose first message is that file.
The old transcript stays on the old store and is not sent again.

A file write by itself does not shrink the live prompt.
The continuation token still replays the full store, including tool results.

## Tool

| | |
| --- | --- |
| Name | `handoff` |
| File | `hosts/cursor/bot/tools/handoff.ts` |
| Effect | `write` |
| Surface | Server tool. The SDK advertises it next to the MCP allowlist. |
| Not | An Elixir entry, and not a `call_function` slug. |

`defineAgent` stays `tools: ["mcp"]`.
The four codex tools stay `find_function`, `define_function`, `load_function`, and `call_function`.
The tool writes a file and a pointer.
It does not compose the assistant reply.

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
The tool renders `handoff.md` from these fields.
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

The rendered file is at most 12,000 bytes.
Over that cap the call errors and writes nothing.

### Return

The file is `handoff.md` in the session workspace (`ctx.workspaceDir`, `.sessions/<id>/`).

```json
{ "path": "handoff.md", "bytes": 0, "confirmation": "Wrote handoff.md (0 bytes)." }
```

`bytes` is the UTF-8 length of the file.
`confirmation` is that one line.
The return does not include the argument fields.

### Pointer

The same call puts `{ "path": "handoff.md", "bytes": N }` at `ctx.host.kv` key `handoff/<sessionId>`.
The value has no summary body.
That key is the source of truth for the path.
The tool writes it in the same call as the file.
The store is shared across sessions, and the harness does not query MiniGraf to find the file.

The tool does not call `memory.remember` and does not write `ctx.host.files`.
A later `memory.remember` may store the path only, in `description`, with the session id.
That fact is an index for another conversation.
It is not the seed.

A second call overwrites `handoff.md` and the same kv key.
A dry-run session stubs the write, does not put the key, and returns the same three fields with confirmation `Dry run. handoff.md was not written.`

## Why this session stays large

This SDK cannot replace history on the current session.
A session is an append-only transcript.
`defineAgent` has no compact or history-budget option.
`POST /v1/session/:id` accepts `{ continuationToken, message }` and resumes the full store.
`ctx.send` starts a turn on a session, and the tool does not call it.

The turn that calls `handoff` stays on the old store.
The tool result stays in that store.
That turn is not smaller.

## Fork

The shrink is the next TUI send.
`CursorAdapter.send` follows up only while it holds a continuation token (`tui/adapters/cursor.ts`).

1. `action.result` names `handoff` and `isError` is not true. The adapter arms a fork.
2. The next user message does not call `followUp`.
3. The adapter reads `handoff.md` from `.sessions/<oldId>/`.
4. It `POST /v1/session` and opens a new store.
5. The message is the line `Continue this work from the handoff below. The prior transcript is not in this session.`, a blank line, the file, a blank line, and the user text.
6. `workspaceFiles` is `{ "handoff.md": <file> }`, so the new workspace keeps that relative path.
7. `title` is the old session title.
8. The response `sessionId` and `continuationToken` replace the adapter's. `nextIndex` restarts at 0.

The old session id and the old continuation token stay on the old store.
A follow-up to that old token still replays the full transcript.
The SDK has no call that truncates it.

```text
user message
    → model calls handoff
        → handoff.md + kv pointer on the old session
            → next user message
                → new agent store, first message is the handoff file + that message
```

### Session chain

`GET /v1/sessions` has no parent field.
The adapter records `{ "<oldId>": "<newId>" }` in `hosts/cursor/.agent-serve/handoff-chain.json`.
That file is the chain of session ids.
It does not hold the handoff text.

`listSessions` omits every predecessor id.
`openSession` of a predecessor opens the latest successor.
The live transcript is not cleared.
`/new` is the path that clears it (`openSession(undefined)` in `tui/main.ts`).
This fork is not `/new`.
A restart shows the successor transcript, which starts at the handoff seed, under the same title.

The playground and `agent-sdk run` keep the continuation token.
A follow-up there still sends the full store.
Only the TUI adapter forks.

## When the model calls it

The model calls `handoff` when the user asks to compact, or when the user says the context footer is warning or error.
The footer is muted under 60% of 200,000, warning from 60% through 85%, and error above 85% (`tui/theme.ts`).
The model does not see that ratio.
The tool description carries this rule.
No line is added to `instructions.md`.

The tool schema is on every turn.
The named-read case in `hosts/cursor/evals/context-size.eval.ts` is measured before the tool stays.
The budget is 32,000 input tokens.
One always-on line raised that case from 25,699 to 25,811 and was reverted.
If the model does not call the tool, one later line can go in `instructions.md` beside the tool list.
That line is measured on the same named-read case before it stays.

## Checks

**Contract, no model turn.** `agent-sdk tool call handoff --dir hosts/cursor --input '<json>' --json`.

- `path` is `handoff.md`.
- `bytes` equals the rendered UTF-8 length.
- `confirmation` is the one line above.
- The result has no section body.
- An unknown key, an empty `state`, or an empty `next` is `invalid_tool_input`, and nothing is written.
- An unbound call uses a scratch workspace that is removed when the call returns. This check locks the return value.
- A session-bound call checks that `handoff.md` exists in that workspace and that kv `handoff/<sessionId>` is `{ path, bytes }` with no body. Opening a session with `POST /v1/session` starts a model turn, so that check is separate.

**Model eval, later.** Not part of bringing the tool up.

- The compact turn called `handoff`.
- The reply did not tell the user to run `/new`. `/new` is a TUI command, not a tool.
- The following turn is a new session whose first message is the handoff file. A second `t.send` on the same eval session follows the continuation token and keeps the old transcript.
- The new session's `inputTokens` are the fixed base plus the handoff (at most 12,000 bytes) plus the new user message, and they are far below the pre-handoff transcript.

## Out of scope

- Automatic compaction, and shrinking the turn that calls the tool.
- An always-on handoff paragraph, and copying the summary into MiniGraf.
- Rewriting `docker.ps`, `docker.ps_report`, `docker.overview`, or the `call_function` digest.
- Footer colors, the cached/new split, and a footer prompt.
