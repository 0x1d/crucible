---
title: ACP client host
description: Runs external Agent Client Protocol agents as Alchemist hosts.
project: alchemist
tags: [host, acp, mcp]
---

# ACP client host

This directory runs external CLI agents over the [Agent Client Protocol](https://agentclientprotocol.com).
Alchemist is the ACP client, and the selected CLI process is the ACP agent.
The long-lived processes are the agent subprocess, owned by `AcpAgentConnection`, and the BEAM, owned by the Elixir bridge in `core/elixir-bridge.ts`.
The ACP host runs in the terminal UI only, and the `serve` channel does not route to it.

| File | Responsibility |
| --- | --- |
| `registry.json` | Agents shipped with the repository. |
| `discovery.ts` | Merges the registry with the user config and resolves spawn specs. |
| `probe.ts` | Marks an agent available after a short `initialize` exchange. |
| `spawn.ts` | Starts an agent subprocess and sends its stderr to `console.error`. |
| `connection.ts` | Owns one subprocess and connection: sessions, prompt turns, cancel, and teardown. |
| `harness.ts` | Serves `fs/read_text_file` and `fs/write_text_file` inside the allowed roots. |
| `alchemist-mcp.ts` | Exposes the codex tools factory from `hosts/shared/alchemist-mcp-tools.ts`. |
| `agent.ts` | Example agent without MCP-over-ACP. |
| `mcp-over-acp-agent.ts` | Scripted agent with MCP-over-ACP and session loading, used by tests and the eval. |

`tui/adapters/acp.ts` implements `HostAdapter` and maps session updates to TUI events.

## Configure agents

User entries live in `~/.config/alchemist/acp-agents.json`, and an entry overrides a registry agent with the same id.

```json
{
  "agents": {
    "Example Agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent.ts"],
      "cwd": "${workspace}"
    }
  }
}
```

The id is a slug of the entry name.
An agent starts in the repository root unless its entry sets `cwd`.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run tui` | Lists probed agents in the host dialog. |
| `npm run probe:acp` | Prints the probe result for each configured agent. |
| `npm run spike:acp` | Runs one prompt against `agent.ts`. |
| `npm run eval:acp` | Calls `memory.overview` through MCP-over-ACP. It needs Elixir on `PATH`. |

## Behavior

- **Codex tools:** An agent that declares `mcpCapabilities.acp` receives an MCP server named `alchemist` in `session/new`, with `find_function`, `define_function`, `load_function`, and `call_function`.
- **Handoff:** The `handoff` tool is listed while `historyReclaim` is `handoffFork`, which is the default.
- **Chat-only mode:** An agent without MCP-over-ACP runs without codex tools or handoff forks, and the TUI shows a notice.
- **File access:** `fs/*` requests resolve symlinks and stay inside the repository root and the session harness directories.
- **Permissions:** The TUI opens a dialog for each `session/request_permission`.
  Stopping the turn answers `cancelled`.
  An adapter without a handler refuses the request.
- **Cancel:** Esc sends `session/cancel`.
  An agent that does not stop within 10 seconds loses its connection.
- **Restarts:** The next turn after an agent exit starts a new process and reloads the session with `session/load`.
  When that fails, the turn reports an error and starts a new session.

## State files

| Path | Contents |
| --- | --- |
| `hosts/acp/.agent-serve/host-flags.json` | Host flags, managed with `/flags`. |
| `hosts/acp/.agent-serve/agents/<agent-id>/sessions.json` | Session index: id, title, cwd, and update time. |
| `hosts/acp/.sessions/<uuid>/` | Harness directory, which is the session cwd. |
| `.alchemist/tui/tui.log` | Agent stderr while the TUI runs. |
