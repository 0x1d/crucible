---
id: crucible/alchemist/host-acp/requirements
title: Requirements
type: REQ
owner: crucible/alchemist/host-acp
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/architecture/host-adapters]
related: [crucible/alchemist/security]
planned: []
---

# Requirements

The ACP host lets a person pick an external command-line agent that speaks the Agent Client Protocol (ACP) and chat with it in the Alchemist terminal UI. Alchemist is the ACP client. It finds and probes the configured agents, keeps file access inside the repository and the session folders, puts every permission request to the user, and gives agents that support MCP-over-ACP the same codex tools that the other hosts have. The host runs only in the terminal UI. Serving ACP agents through the `serve` channel, and agents reached over HTTP or WebSocket, are open items, not requirements yet.

## 1 Purpose

Alchemist's codex is shared by every host, but the Claude and Cursor hosts are each written against one vendor SDK. Many coding agents already speak ACP. An ACP client host lets the user run any of them against the same codex, memory and session handling, without one adapter per agent.

## 2 Scope

| In scope | Out of scope |
| --- | --- |
| Finding agents in the shipped registry and the user's config, and probing them | Scanning `PATH` for agent binaries; an unconfigured binary is never started |
| Agents reached over stdio, as a subprocess | Agents reached over HTTP or WebSocket (crucible/alchemist/OI-05) |
| Chat turns in the terminal UI ([crucible/alchemist/tui](../tui/README.md)) | The `serve` channel (crucible/alchemist/OI-04) |
| Codex tools and the handoff tool through MCP-over-ACP | Codex tools through any other transport |
| File access and permission requests from the agent | The agent's own tools, which the agent runs itself |
| ACP v1 | ACP v2 (crucible/alchemist/OI-06) |

## 3 Users and actors

| Actor | Kind | Goal |
| --- | --- | --- |
| User | person | Pick an agent, chat with it, approve or refuse what it asks to do |
| ACP agent | external system | Run turns, read and write files, call the codex tools |
| Terminal UI | component ([crucible/alchemist/tui](../tui/README.md)) | Drive the host through the `HostAdapter` interface |
| Alchemist runtime | component ([crucible/alchemist/runtime](../runtime/README.md)) | Serve the codex operations behind the tools |

## 4 Goals

| Id | Goal |
| --- | --- |
| G-01 | Any configured ACP agent can be selected in the terminal UI and used for a chat |
| G-02 | An agent that supports MCP-over-ACP can use the same codex tools as the Claude host |
| G-03 | An agent cannot reach files outside the repository and its session folder, or act without the user's consent |
| G-04 | Sessions survive an agent restart where the agent supports it, and a failure never takes the terminal UI down |

## 5 Functional requirements

| Id | Requirement | Acceptance | Priority | Goal |
| --- | --- | --- | --- | --- |
| FR-001 | The host shall list the agents of the shipped registry and of the user config file, and a user entry shall replace a registry agent with the same id. | Registry and user lists with one shared id merge to one entry, from the user | must | crucible/alchemist/host-acp/G-01 |
| FR-002 | The host shall replace `${workspace}` in an agent's arguments and working directory, and start an agent without a working directory in the repository root. | A spawn spec with `${workspace}` in args and cwd resolves both | must | crucible/alchemist/host-acp/G-01 |
| FR-003 | The host shall mark an agent available only after it answers `initialize`, and report the reason when it does not. | A probed fixture reports `ok` with its protocol version and MCP-over-ACP support; a missing binary reports `failed` with a reason | must | crucible/alchemist/host-acp/G-01 |
| FR-004 | If the user selects an agent whose probe failed, then the terminal UI shall refuse it and show the probe's reason. | Selecting a failed agent shows "unavailable" and the reason | must | crucible/alchemist/host-acp/G-01 |
| FR-005 | When a session starts, the host shall create a new harness folder and pass it to the agent as the session's working directory. | After one turn, exactly one folder exists under `.sessions/` | must | crucible/alchemist/host-acp/G-03 |
| FR-006 | While a turn runs, the host shall stream the agent's message, thought, tool and usage updates as host events, and end the turn with `done` when the agent stops with `end_turn`. | A turn yields `reasoning`, `tool`, `tool_result`, `text`, `usage`, `done` in order | must | crucible/alchemist/host-acp/G-01 |
| FR-007 | When the agent stops a turn for a reason other than `end_turn` or `cancelled`, the host shall report an error that names the reason. | A stop with `refusal` yields an error naming `refusal` | must | crucible/alchemist/host-acp/G-01 |
| FR-008 | The host shall report each tool call once and its result once, whether the call first appears as a call or as an update. | Repeated updates of one call yield one `tool` and one `tool_result` | must | crucible/alchemist/host-acp/G-01 |
| FR-009 | The host shall add a reported cost to the session's cost only when it is in USD, and report an agent notice of severity `error` as an error. | A cost in EUR is dropped; an error notice yields an `error` event | should | crucible/alchemist/host-acp/G-01 |
| FR-010 | When the agent asks to read or write a file, the host shall serve the request only for an absolute path that, with symlinks resolved, lies inside the repository root or a harness folder of the connection. | A read inside the repository succeeds; a read outside it, or through a symlink that leaves the roots, is refused with invalid params | must | crucible/alchemist/host-acp/G-03 |
| FR-011 | When the agent asks for permission, the host shall pass the request to the permission handler, and the terminal UI shall show it as a dialog with the agent's options. | The handler's choice reaches the agent | must | crucible/alchemist/host-acp/G-03 |
| FR-012 | If no permission handler is set, then the host shall choose the agent's reject option, or answer `cancelled` when the agent offers none. | Without a handler, the agent receives a rejection | must | crucible/alchemist/host-acp/G-03 |
| FR-013 | When an agent declares MCP-over-ACP support, the host shall provide an MCP server named `alchemist` with the codex tools in every `session/new` and `session/load`, registered before the session is created. | The tool list holds every name of `HOST_TOOL_NAMES` | must | crucible/alchemist/host-acp/G-02 |
| FR-014 | While the host flag `historyReclaim` is `handoffFork`, the `alchemist` MCP server shall also list the `handoff` tool. | With the default flags, the tool list holds `handoff` | should | crucible/alchemist/host-acp/G-02 |
| FR-015 | When the agent calls `call_function`, the host shall run the call on the Alchemist runtime and return its JSON result. | `call_function` on `memory.overview` returns `ok: true` | must | crucible/alchemist/host-acp/G-02 |
| FR-016 | If the agent does not declare MCP-over-ACP support, then the host shall run the session without codex tools and without handoff forks, and show a notice saying so. | A plain agent chats, the notice names the missing codex tools, and a turn over the context budget is not routed to a handoff | must | crucible/alchemist/host-acp/G-02 |
| FR-017 | When the user stops a turn, the host shall send `session/cancel`, answer a pending or later permission request of that turn with `cancelled`, and keep the session usable for the next turn. | A stopped turn yields no error, a pending permission request is answered `cancelled`, and the next turn ends with `done` | must | crucible/alchemist/host-acp/G-04 |
| FR-018 | When a turn starts, the host shall record the session in its session index, with the first prompt as the title, and list indexed sessions newest first. | After a turn, the session list holds the session with the prompt as title | must | crucible/alchemist/host-acp/G-04 |
| FR-019 | When the user opens an indexed session, the host shall load it with `session/load` and show the replayed history; if the agent cannot load sessions, then the host shall refuse with an error. | A reopened session replays its user and agent messages; an agent without `loadSession` rejects the open | must | crucible/alchemist/host-acp/G-04 |
| FR-020 | If the agent process exits, then the host shall end the running turn with an error, and the next turn shall start a new process and reload the session, or report that it could not and start a new session. | After a crash the next turn reports "could not reload the session" and ends with `done` in a new session | must | crucible/alchemist/host-acp/G-04 |
| FR-021 | If an agent cannot be started, then the host shall fail the session open with the reason and keep the terminal UI running. | A missing binary rejects with "cannot start ..." | must | crucible/alchemist/host-acp/G-04 |
| FR-022 | The host shall offer the agent's `model` and `thought_level` session config options as the model and effort choices, and apply a change to the running session. | The fixture's models and efforts are listed, and a change applies before the next turn | should | crucible/alchemist/host-acp/G-01 |
| FR-023 | While the handoff fork is on, when a handoff tool call succeeds, the host shall start the next prompt in a new session seeded with the handoff file; over the context budget without a handoff, the host shall stop with an error. | A successful handoff forks the next prompt into a new session titled with the handoff; a turn over budget without one reports "Handoff did not complete" | should | crucible/alchemist/host-acp/G-04 |
| FR-024 | The host shall write the agent's stderr to the terminal UI log, not to the screen. | Inspection of `hosts/acp/spawn.ts` | should | crucible/alchemist/host-acp/G-04 |

## 6 Operational requirements

| Id | Quality | Requirement | Measure |
| --- | --- | --- | --- |
| OR-001 | latency | A probe that gets no `initialize` answer shall fail within the agent's probe timeout, 8000 ms unless the agent entry sets `probe.timeoutMs`. | Time from spawn to `failed`, with an agent that never answers |
| OR-002 | availability | If the agent does not end a cancelled turn within 10 s, then the host shall close the connection and stop the process. | Time from `session/cancel` to connection close, with an agent that ignores cancel |

## 7 Constraints

| Constraint | Source |
| --- | --- |
| Alchemist is the ACP client; the agent is the selected external process | crucible/alchemist/host-acp/AD-01 |
| `@agentclientprotocol/sdk` 2.4.0, pinned; MCP-over-ACP from its unstable entry | crucible/alchemist/host-acp/AD-02 |
| Codex tools come from the definitions shared with the Claude host | crucible/alchemist/host-acp/AD-03 |
| The host implements the terminal UI's `HostAdapter` | [crucible/alchemist/architecture/host-adapters](../architecture/host-adapters.md) |

## 8 Assumptions

- Agents that support session resume implement `session/load` and replay the history as updates before answering.
- An agent reports model and effort as select options with the categories `model` and `thought_level`.

## 9 Terminology

| Term | Meaning |
| --- | --- |
| ACP | Agent Client Protocol, JSON-RPC between an editor-like client and a coding agent |
| Agent | The external process that speaks ACP as the agent side |
| MCP-over-ACP | An MCP server provided by the client and reached by the agent through ACP messages, declared by the agent as `mcpCapabilities.acp` |
| Harness folder | The per-session working directory `hosts/acp/.sessions/<uuid>/` |
| Probe | A short `initialize` exchange that decides whether an agent is available |
