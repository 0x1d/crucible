---
id: crucible/alchemist/host-cursor/design/host-flags
title: Host Flags
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-cursor/design]
related: [crucible/alchemist/host-cursor/decisions]
planned: []
---

# Host Flags

Host flags switch the context levers of a host on and off: the result digest, default read caps, the pinned model, the tool result log, and the history reclaim mode. They also hold the memory and explore settings and the context budget. Each host has its own flag file; the Cursor host's defaults are listed here, and the Claude and ACP hosts read the same file format with their own defaults. The code is `hosts/cursor/bot/lib/host-flags.ts`; the terminal UI edits the flags with `/flags`.

## 1 Storage

| Item | Value |
| --- | --- |
| File | `hosts/<host>/.agent-serve/host-flags.json`, where `<host>` is `cursor`, `claude` or `acp` |
| Missing or unreadable file | The host's defaults |
| Merge | Every known key with the right type replaces the default; unknown keys and wrong types are ignored |
| Environment override | `ALCHEMIST_HOST_FLAG_<SNAKE_CASE>` (`hostFlagEnvKey()`) for `resultDigest`, `defaultMaxBytes`, `pinnedModel`, `toolResultLog` and the derived reclaim booleans, e.g. `ALCHEMIST_HOST_FLAG_RESULT_DIGEST=0`; `ALCHEMIST_HOST_FLAG_HISTORY_RECLAIM=<mode>` sets the reclaim mode. The memory and explore settings, `maxContextTokens` and `sessionModel` have no override. Used by the evals |
| When a change applies | Serve-side flags on the next `serve()` start, so after a TUI restart or `/host`; the TUI adapter reads its flags per turn |

A file written before a default changed keeps its stored value until it is edited.

## 2 Flags

| Flag | Type | Cursor default | Effect | Specified in |
| --- | --- | --- | --- | --- |
| `resultDigest` | boolean | on | Replaces a large codex tool result with a digest and stores the full result | [crucible/alchemist/host-cursor/design/tool-results](tool-results.md) |
| `defaultMaxBytes` | boolean | on | Adds `max_bytes: 65536` to `fs.read` and `http.get` calls that do not set it | [crucible/alchemist/host-cursor/design/tool-results](tool-results.md) |
| `pinnedModel` | boolean | off | Pins the agent's model so a follow-up reuses the cached prefix | [crucible/alchemist/host-cursor/design/prompt-cache](prompt-cache.md) |
| `toolResultLog` | boolean | off | Logs the size of each tool result to `.agent-serve/context-tool-sizes.log` | [crucible/alchemist/host-cursor/design/tool-results](tool-results.md) |
| `historyReclaim` | mode | `handoffFork` | The one active history reclaim mechanism (section 3) | section 3 |
| `maxContextTokens` | integer | 200000 | Context budget: the footer's window and the handoff fork threshold | [crucible/alchemist/host-cursor/design/context-handoff](context-handoff.md) |
| `sessionModel` | `{ id, effort? }` | none | Model the TUI picked, applied when `agent.ts` loads | [crucible/alchemist/host-cursor/design/prompt-cache](prompt-cache.md) |
| `memoryAutoRetain` | boolean | off | Queue a retain prompt every `memoryRetainEveryTurns` turns | [crucible/alchemist/host-cursor/design/explore-and-memory](explore-and-memory.md) |
| `memoryRetainEveryTurns` | integer | 0 | Retain interval; 0 turns auto retain off | [crucible/alchemist/host-cursor/design/explore-and-memory](explore-and-memory.md) |
| `memoryRecallBeforeExplore` | boolean | on | Prepend a memory recall block to each user turn | [crucible/alchemist/host-cursor/design/explore-and-memory](explore-and-memory.md) |
| `requireExploreBeforeProbe` | boolean | off | Block raw probe slugs until `explore` runs in the turn | [crucible/alchemist/host-cursor/design/explore-and-memory](explore-and-memory.md) |

`maxContextTokens` accepts `256000`, `256k` or `1m` from `/flags`.

## 3 History reclaim

History reclaim shrinks or replaces a transcript that is already large. Exactly one mechanism is active, chosen by `historyReclaim`, so an SDK compaction and the handoff fork never run together (crucible/alchemist/host-cursor/AD-07).

| Mode | Hosts | Mechanism |
| --- | --- | --- |
| `summarize` | Cursor | The SDK's own summarize; not reachable on the HTTP session path (crucible/alchemist/OI-07) |
| `autocompact` | Claude | The Claude Agent SDK's autocompact (`autoCompactEnabled`) |
| `handoffFork` | Cursor, Claude, ACP | The `handoff` tool writes `handoff.md`, and the TUI forks into a new session ([crucible/alchemist/host-cursor/design/context-handoff](context-handoff.md)) |
| `off` | all | None |

The defaults are `handoffFork` for Cursor and ACP and `autocompact` for Claude. A stored mode that the host does not allow is mapped: `autocompact` on Cursor becomes `summarize`, `summarize` on Claude becomes `autocompact`, anything else becomes `off`.

The booleans `handoffTool`, `handoffFork`, `autoSummarize` and `autoCompact` are derived from the mode and are never stored on their own. `/flags on <boolean>` and `/flags reclaim <mode>` both set the mode. A file without `historyReclaim` is read through its booleans, in the order `autoSummarize`, `autoCompact`, `handoffFork` or `handoffTool`, else `off`.
