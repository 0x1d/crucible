---
title: Claude Agent SDK host
description: Example Alchemist host on the Claude Agent SDK.
project: alchemist
tags: [host, claude, agent-sdk, evals]
---

# Claude Agent SDK host

This directory is an example Alchemist host built on `@anthropic-ai/claude-agent-sdk`.
It exposes the codex as four tools on an in-process MCP server named `alchemist`.
The Claude Code harness runs the agent loop.
The Elixir bridge in `core/elixir-bridge.ts` owns the long-lived BEAM, as for every other host.

| File | Responsibility |
| --- | --- |
| `codex.ts` | Defines the four tools, the MCP server, and `alchemistOptions()` for `query()`. |
| `instructions.md` | The system prompt. It tells Claude to use and extend the codex tools. |
| `session-hook.ts` | `PreToolUse` hook that stamps the live session id as `source_session` on `memory.remember` calls. |
| `chat.ts` | Interactive terminal loop. One `query()` per turn, resumed by session id. |
| `evals/run.ts` | Eval runner. Sends one prompt and records tool calls and the final text. |
| `evals/*.eval.ts` | Eval cases under `node:test`. |

## Host flags

Claude shares the Cursor host-flag schema (`hosts/cursor/bot/lib/host-flags.ts`).
State lives under `hosts/claude/.agent-serve/host-flags.json`.
Toggle with `/flags` in the TUI while the Claude host is active.

**History reclaim is exclusive** (`historyReclaim`). Claude allows `autocompact` only as its SDK mode (Cursor uses `summarize` instead):

| Mode | Effect |
| --- | --- |
| `autocompact` (default) | Claude SDK `autoCompactEnabled`; handoff tool hidden |
| `handoffFork` | Handoff MCP tool + TUI fork; SDK autocompact off |
| `off` | Neither |

Other flags (`resultDigest`, `defaultMaxBytes`, `pinnedModel`, `toolResultLog`) apply the same way as on Cursor.
`/flags reclaim <autocompact|handoffFork|off>` switches reclaim; `/flags on autoCompact` / `handoffFork` are aliases that keep exclusivity. `autoSummarize` is Cursor-only.

## Query options

`alchemistOptions()` sets a minimal configuration:

- `systemPrompt` is the content of `instructions.md`. The Claude Code preset is not loaded.
- `tools: []` removes every built-in tool. Claude sees only the codex MCP tools (plus `handoff` when reclaim is `handoffFork`).
- `allowedTools` lists `mcp__alchemist__<tool>` for each exposed tool, so no permission prompt appears.
- `settings.autoCompactEnabled` follows `historyReclaim === "autocompact"`.
- `settingSources: []` ignores user and project settings files.
- `cwd` is the repository root.
- `hooks.PreToolUse` runs `session-hook.ts`, so remembered facts can be traced back with `memory.by_session`.
- `call_function` applies `resultDigest` / `defaultMaxBytes` from host flags.

Tool names follow `core/protocol.ts`: `find_function`, `define_function`, `load_function`, and `call_function`.
Each tool returns the codex JSON response as text.
A response with `"ok": false` is returned with `isError: true`.

## Run the chat

Prerequisites: Node 24+, Elixir 1.14+, and Claude Code credentials.
The SDK reads the same credentials as the `claude` CLI, or `ANTHROPIC_API_KEY`.

```bash
npm run chat:claude
```

Type a request at the `you>` prompt. Type `exit` or press Ctrl-D to stop.
The loop prints each tool call as `[tool] <name> <input>` and then the final reply.

## Run the evals

```bash
npm run eval:claude
```

| Eval file | Checks |
| --- | --- |
| `smoke.eval.ts` | `call_function` runs the bundled `echo` entry. `find_function` lists entries. |
| `extend.eval.ts` | `define_function` writes a new entry and `call_function` runs it. The test removes the entry afterwards. |
| `memory.eval.ts` | `memory.remember` is stamped with the live session id by the hook, and `memory.by_session` finds it. |

Each eval sends real requests to Claude and starts the BEAM through the bridge.
`evals/run.ts` gives every eval run its own temporary state directory and memory graph, so an eval never stops a live chat or TUI BEAM and never writes to the repo memory graph. Set `ALCHEMIST_EVAL_STATE_DIR` to pin the folder.
The `extend` eval writes to `functions/scratch/claude_eval/`. Its `after` hook removes every entry under `functions/` that did not exist before the run.
