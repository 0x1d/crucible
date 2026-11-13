---
id: crucible/alchemist/host-cursor/design/explore-and-memory
title: Explore and Memory
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-cursor/design, crucible/alchemist/host-cursor/design/host-flags]
related: [crucible/alchemist/host-cursor/decisions]
planned:
  - id: crucible/alchemist/host-cursor/P-05
    title: Explore gate on by default
    depends: []
---

# Explore and Memory

Every probe the model makes is one tool round trip and one result in the transcript. The codex entry `explore` runs a fixed probe pipeline in Elixir and returns only the essentials, so one call replaces a chain of `memory.overview`, `git.status`, log and search calls. Around it the host has three optional automations: a gate that blocks raw probes until `explore` has run in the turn, a memory recall block prepended to each user turn, and an automatic retain prompt every few turns. All are controlled by host flags ([crucible/alchemist/host-cursor/design/host-flags](host-flags.md)).

## 1 The explore entry

`explore` (`functions/explore/tool.ex`, module `AgentFn.Explore`) is a codex entry; its moduledoc is its contract. The host relies on these profiles:

| Profile | Runs | Returns |
| --- | --- | --- |
| `status` (default) | Memory recall, compact git status, one-line log, head of `handoff.md` when present | Summary, memory, git, log, handoff |
| `memory` | Memory overview with descriptions | Entity ids and descriptions |
| `repo` | Compact git status and one-line log | Branch, counts, path sample, log lines |
| `code` | `fs.rg` with a low match cap | Matches |
| `custom` | `steps` through `pipeline.run`, seeded with memory when `recall_memory` | The pipeline result |

`limit` caps the lists (default 12). Compact git is branch, upstream, ahead and behind, counts, and at most `limit` paths per bucket. The instructions name `explore` in the need table, and the memory skill names `explore` with `profile: "status"` for status turns.

## 2 Explore gate

`hosts/cursor/bot/lib/explore-gate.ts`, called by `call_function` while `requireExploreBeforeProbe` is on.

| Slugs | Rule |
| --- | --- |
| `explore` | Allowed; marks the gate satisfied |
| `fs.read` | Allowed; marks the gate satisfied |
| `memory.*` | Allowed |
| Probes: `fs.list`, `fs.glob`, `fs.rg`, `sys.cmd`, `git.*`, `http.*` | Blocked until the gate is satisfied |
| Every other slug | Allowed |

A blocked call returns `{ ok: false, isError: true, error: "requireExploreBeforeProbe: call explore first (e.g. profile status, repo, or code) before raw probes like <slug>" }` without reaching the runtime. The gate state is per session workspace and lives in the serve process. The hook `hosts/cursor/bot/hooks/explore-gate.ts` resets it on every `message.received`. `find_function`, `define_function` and `load_function` are not gated.

### Gate on by default

**Planned** P-05.

The gate stays off by default until the `explore-status` eval shows that turning it on keeps status turns inside the budget.

**Slices**

1. Run `context-size/explore-status` and `context-size/named-read` with `requireExploreBeforeProbe: true` in the eval's host flag file, record the input tokens, and fix any case that exceeds its budget.
2. Set `requireExploreBeforeProbe` to `true` in `DEFAULT_MEMORY_EXPLORE_SETTINGS` and in its unit test.
3. Remove the always-on lines in `hosts/cursor/bot/instructions.md` that only ask for `explore` before probes, if the gate makes them redundant, and re-run `context-size/named-read`.

**Done when**

- `context-size/explore-status` passes at or under 32,000 input tokens with the default flags.
- `context-size/named-read` passes at or under 32,000 input tokens with the default flags.
- `hosts/cursor/bot/lib/host-flags.test.ts` asserts the new default.

## 3 Memory recall

While `memoryRecallBeforeExplore` is on, the host appends a recall block to the user's message before it is sent: the HTTP channel in its `onMessage` (`hosts/cursor/bot/channels/http.ts`) and the TUI adapter before it creates or follows up a session. The block comes from `explore` with `profile: "memory"` and `limit: 8`:

```text
<user message>

[memory-recall]
- `<entity id>`: <description, at most 200 characters>
[/memory-recall]
```

The block is skipped for a named-path read turn (a message `read <path>` whose path has a separator, starts with `..` or `/`, or has a file extension), when memory has no entities, and when the call fails.

## 4 Auto retain

While `memoryAutoRetain` is on and `memoryRetainEveryTurns` is at least 1, the host sends the `/remember` prompt every `memoryRetainEveryTurns` completed turns, so the model stores durable facts itself; the host never calls `memory.remember` directly.

| Surface | Counter | Delivery |
| --- | --- | --- |
| Terminal UI | `completedTurns` in `tui/main.ts`, `shouldAutoRetain` in `tui/auto-memory-retain.ts` | Queues `/remember` in the follow-up queue |
| Serve | Host kv per session (`hosts/cursor/bot/lib/auto-memory-retain-kv.ts`), seeded from the session's events on `message.received` | The hook `hosts/cursor/bot/hooks/auto-memory-retain.ts` creates and dispatches a reminder with the remember prompt, queued behind the running turn |

The serve path needs host reminders and a channel continuation token; without them it does nothing.
