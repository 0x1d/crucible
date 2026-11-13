---
id: crucible/alchemist/host-cursor/design/context-budget
title: Context Budget
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-cursor/design]
related: [crucible/alchemist/host-cursor/decisions, crucible/alchemist/host-cursor/design/tool-results]
planned:
  - id: crucible/alchemist/host-cursor/P-04
    title: Prompt shrink and find-detail gate
    depends: []
---

# Context Budget

The Cursor host has no automatic compaction: the agent store keeps every turn, with every tool result, and replays it on each follow-up. What keeps a session inside the 200,000-token window is a small always-on prompt, small tool results, and the handoff when the window fills. This document says what a prompt is made of, which always-on rules keep turns short, how the footer reports the size, and the token budgets the `context-size` eval enforces.

## 1 Prompt composition

| Part | Source | Sent |
| --- | --- | --- |
| Harness | Cursor SDK system prompt and safety rules | Every turn |
| Host prompt | `hosts/cursor/bot/instructions.md` (about 7 KB); longer material in `hosts/cursor/bot/skills/codex.md` and `memory.md`, read on demand | Every turn |
| Tool schemas | The four codex tools and `handoff` | Every turn |
| Transcript | Every earlier message and tool result of the session | Every follow-up, mostly from the prompt cache |
| Memory recall | The `[memory-recall]` block, while `memoryRecallBeforeExplore` is on ([crucible/alchemist/host-cursor/design/explore-and-memory](explore-and-memory.md)) | Appended to each user turn |

The agent may use only the MCP tools (`tools: ["mcp"]` in `hosts/cursor/bot/agent.ts`): no native read, edit or shell. Each session workspace is its own git root, so the repository's `AGENTS.md`, ambient MCP servers and the user's skills do not enter the prompt.

## 2 Always-on rules

`instructions.md` holds the rules that keep a turn to few, small tool calls. They are model policy, not enforced by the host; the budgets in section 4 catch a regression.

- A named file path is one `fs.read` from the repository root, without a search first.
- A known slug (from the need table, a skill, or this turn's `find_function`) is one `call_function`, without a second `find_function`.
- `find_function` with `detail: true` only with an exact slug, to edit the entry or when the slim hit lacks required arguments.
- One composed entry such as `explore` instead of chains of probes.
- A `truncated: true` result is read through its `path`, not fetched again.

A new always-on line costs input tokens on every turn and is kept only when `context-size/named-read` still passes (crucible/alchemist/host-cursor/AD-10).

## 3 Footer

The TUI footer reports the last turn's usage. `ctx` is the turn's full prompt (`contextTokens()` in `tui/adapters/cursor.ts`, which counts the cache buckets once), against the window `maxContextTokens`. `new` is the uncached part. The size is colored by fixed thresholds in `tui/theme.ts`: success below 150,000 tokens, warning from 150,000 through 200,000, error above 200,000. A falling `ctx` without a handoff does not mean the store dropped anything: it is a different turn's prompt, or cache accounting.

## 4 Budgets

`hosts/cursor/evals/context-size.eval.ts` runs one turn per case and fails when the input tokens exceed the budget. It needs a Cursor credential and Elixir on `PATH` (`nix develop`).

| Case | Turn | Budget (input tokens) | Also checks |
| --- | --- | --- | --- |
| `named-read` | `read` of `hosts/cursor/evals/fixtures/named-read.md` | 32,000 | One `call_function` `fs.read`, no `find_function`; the reply mentions autocompact |
| `large-read` | `fs.read` of a 142 KB file | 24,000 | The result is a string digest with `truncated: true` |
| `docker-report` | `docker.ps_report` | 16,500 | One call, no container list |
| `structured-list` | `docker.ps` | 16,500 | The result is an array digest whose sample is shorter than the array |
| `find-search-slim` | `find_function` search for `memory` | 28,000 | Slim hits with run/1 `@spec`, no moduledoc |
| `explore-status` | `explore` with `profile: "status"` | 32,000 | One call; the result is compact |

Each budget sits between the measured size with the lever and without it (crucible/alchemist/host-cursor/AD-10). A budget is not raised to make a case pass.

### Prompt shrink and find-detail gate

**Planned** P-04.

The digest covers all four codex tools, but no case measures a `find_function` call with `detail: true`, and the always-on prompt is still about 7 KB.

**Slices**

1. Add the case `context-size/find-detail`: one `find_function` with `detail: true` on a large entry, budget 28,000 input tokens, and the result digested when it is over the digest threshold.
2. Shrink `hosts/cursor/bot/instructions.md` to at most 5,500 bytes by moving duplicated tables and examples into `hosts/cursor/bot/skills/`, re-running `context-size/named-read` after each cut.

**Done when**

- `context-size/find-detail` passes.
- `wc -c hosts/cursor/bot/instructions.md` is at most 5,500.
- Every case in section 4 passes at its budget.
- `hosts/cursor/bot/prompt-stability.test.ts` passes.
