---
title: Claude Agent SDK host
description: Example host that runs the Alchemist codex through the Claude Agent SDK.
project: alchemist
tags: [host, claude, agent-sdk, evals]
---

# Claude Agent SDK host

This directory is an example host for the Alchemist codex built on `@anthropic-ai/claude-agent-sdk`.
The Claude Code harness runs the agent loop.
The four codex operations run as an in-process MCP server named `alchemist`.
The Elixir bridge in `core/elixir-bridge.ts` owns the long-lived BEAM, as for every other host.

| File | Responsibility |
| --- | --- |
| `codex.ts` | Defines the four tools, the MCP server, and `alchemistOptions()` for `query()`. |
| `instructions.md` | The system prompt. It tells Claude to use and extend the codex tools. |
| `chat.ts` | Interactive terminal loop. One `query()` per turn, resumed by session id. |
| `evals/run.ts` | Eval runner. Sends one prompt and records tool calls and the final text. |
| `evals/*.eval.ts` | Eval cases under `node:test`. |

## Query options

`alchemistOptions()` sets a minimal configuration:

- `systemPrompt` is the content of `instructions.md`. The Claude Code preset is not loaded.
- `tools: []` removes every built-in tool. Claude sees only the four codex tools.
- `allowedTools` lists `mcp__alchemist__<tool>` for each codex tool, so no permission prompt appears.
- `settingSources: []` ignores user and project settings files.
- `cwd` is the repository root.

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

Each eval sends real requests to Claude and starts the BEAM through the bridge.
The `extend` eval writes to `functions/scratch/claude_eval/`. Its `after` hook removes every entry under `functions/` that did not exist before the run.
