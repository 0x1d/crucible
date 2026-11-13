---
id: crucible/alchemist/host-cursor/design/context-handoff
title: Context Handoff
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-cursor/design, crucible/alchemist/host-cursor/design/host-flags]
related: [crucible/alchemist/host-cursor/decisions, crucible/alchemist/host-acp/design]
planned: []
---

# Context Handoff

The Cursor agent store cannot be shortened: a follow-up sends only the new message and a continuation token, and the store replays the whole transcript. The handoff shrinks the prompt by leaving the store. The model writes a short `handoff.md` with the `handoff` tool, and the terminal UI's Cursor adapter answers the next user message in a new session whose first message is that file plus the user's text. The old transcript stays on the old session and is not sent again. This is the `handoffFork` reclaim mode ([crucible/alchemist/host-cursor/design/host-flags](host-flags.md)); the ACP adapter uses the same route functions.

## 1 Handoff tool

| Item | Value |
| --- | --- |
| Name | `handoff`, a server tool beside the MCP allowlist (`hosts/cursor/bot/tools/handoff.ts`) |
| Render | `renderHandoff` in `hosts/cursor/bot/lib/handoff.ts` |
| Effect | `write` |
| Enabled | While `handoffTool` is derived on; otherwise the call returns an error saying the tool is disabled |

The description, which is the only always-on text about the handoff:

```text
Write handoff.md for a new session. Call when the user asks to compact, or says the context footer is yellow or red. Then stop. Do not mention /new.
```

### Arguments

One closed object; unknown keys are rejected.

| Field | Required | Bound | Content |
| --- | --- | --- | --- |
| `state` | yes | 1-2,000 characters | Current state of the work |
| `next` | yes | 1-12 strings, each 1-400 characters | Next steps |
| `files` | no | 0-40 strings, each 1-240 characters | Touched paths |
| `systems` | no | 0-20 strings, each 1-120 characters | Touched systems |
| `pitfalls` | no | 0-12 strings, each 1-400 characters | Pitfalls |
| `facts` | no | 0-12 strings, each 1-400 characters | Other facts needed to continue |

### File

`renderHandoff` writes `# Handoff`, then `## State` and `## Next`, then `## Files`, `## Systems`, `## Pitfalls` and `## Facts` for the lists that are not empty, each list item as `- <item>`. The text is at most `HANDOFF_BYTE_CAP`, 12,000 bytes of UTF-8; over the cap, rendering throws `handoff.md would be N bytes, over the 12000 byte cap.` and nothing is written.

The file is `handoff.md` in the session workspace, `hosts/cursor/.sessions/<sessionId>/`. A second call overwrites it.

### Result

```json
{ "path": "handoff.md", "bytes": 802, "confirmation": "Wrote handoff.md (802 bytes)." }
```

`bytes` is the UTF-8 length. The result has no section body. When the call has a session id, the tool also puts `{ path, bytes }` at host kv key `handoff/<sessionId>`. A dry run renders and returns the same fields with the confirmation `Dry run. handoff.md was not written.`, and writes nothing.

## 2 Fork route

`routeTurn` in `tui/adapters/handoff.ts` picks the route of each send from four inputs: whether a session is open, the last turn's prompt size (`contextTokens` of the last `turn.completed`), whether a handoff is pending, and whether `handoff.md` exists in the session workspace. The threshold is the host's `maxContextTokens`, 200,000 by default (`FORK_ABOVE_TOKENS`).

| Session | Last prompt over threshold | Pending handoff | File | Route |
| --- | --- | --- | --- | --- |
| no | any | any | any | `create` with the user text |
| yes | no | no | any | `follow-up` with the user text |
| yes | any | yes | present | `fork` |
| yes | any | yes | missing | `error` "Handoff file is missing. Write handoff.md before continuing."; pending stays set |
| yes | yes | no | any | `compact-then-fork` |

A handoff is pending after a raw `action.result` event with `toolName` `handoff` that is neither `isError` nor `stubbed`. The adapter watches the raw event, because the mapped `tool_result` has no tool name. Opening a session sets pending again when its event log holds such a result. `/new` and a model change that detaches the session clear pending and the stored prompt size.

### Fork

The adapter reads `handoff.md` from the old session's workspace and creates a new session (`POST /v1/session`) whose first message is `seedMessage(file, userText)`: the preamble `Continue this work from the handoff below. The prior transcript is not in this session.`, a blank line, the file without trailing newlines, a blank line, and the user text. The create carries the old session's title; a 400 that names `title` is retried once without it. The new session's id and continuation token replace the old ones, the fork is recorded in the chain (section 3), and the new session's events are the turn's events.

### Compact then fork

Over the threshold without a pending handoff, the adapter first sends `HANDOFF_REQUEST` to the old session: `The context window is full. Call the handoff tool with the working set, then stop. Do not answer the user in this session.` The user text is not in it, and the turn's events are not shown. If the turn produced a successful handoff, the adapter forks with the user text as above. Otherwise it reports `The context window is full and handoff did not complete. The message was not sent.`; the user text reaches neither session, and the next send tries again.

Below the threshold, a user who asks to compact gets a `handoff` call on that turn, and the following message forks.

## 3 Session chain

The Cursor session list has no parent field, so the adapter keeps the forks in `hosts/cursor/.agent-serve/handoff-chain.json`, a map from old session id to new session id.

- `resolveSuccessor` follows the chain for at most 20 steps and returns the last id.
- `listSessions` hides every id that is a key of the chain.
- Opening a predecessor opens and replays its latest successor, which starts at the handoff seed.

The old continuation token still holds the full transcript; nothing in the SDK truncates it.

## 4 Scope

Only the terminal UI adapters fork. The playground and `agent-sdk run` keep their continuation token, and an `agent-sdk eval` follow-up does too, so the fork is checked by unit tests, not by an eval. The turn that calls `handoff` is not itself shrunk, and the handoff body is not copied into memory.
