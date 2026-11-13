---
id: crucible/alchemist/host-acp/decisions
title: Decisions
type: AD
owner: crucible/alchemist/host-acp
status: Draft
date: 2026-11-13
related: [crucible/alchemist/host-acp/design]
---

# Decisions

| Id | Decision | Rationale | Alternatives considered | Status |
| --- | --- | --- | --- | --- |
| AD-01 | Alchemist is the ACP client, and the user-selected CLI process is the ACP agent | Matches the editor model of Zed and other ACP clients, so existing agents work unchanged | Alchemist as an ACP agent | Decided |
| AD-02 | Use `@agentclientprotocol/sdk`, pinned at 2.4.0, and take MCP-over-ACP from its unstable entry | `McpOverAcpProvider` is not on the stable entry yet; pinning keeps the unstable API from moving under the host | Writing the JSON-RPC layer by hand | Decided |
| AD-03 | Serve the codex tools to the agent through MCP-over-ACP, from the tool definitions shared with the Claude host | The agent keeps its own tools and gains the codex; one naming contract (`HOST_TOOL_NAMES`), one bridge (`runCodexOp`) and one set of schemas | A separate MCP server process; tools defined for the ACP host only | Decided |
| AD-04 | An agent is available only after a short `initialize` probe; agents come from the shipped registry and the user config | A binary on `PATH` may not speak ACP; probing avoids listing agents that cannot run | Scanning `PATH` for known names | Decided |
| AD-05 | Code under `hosts/acp/`, beside the other hosts | Same layout as `hosts/claude/` and `hosts/cursor/` | - | Decided |
| AD-06 | The session cwd is a harness folder with the host's own uuid | The agent assigns the session id only after it receives the cwd | Renaming the folder after `session/new` | Decided |
| AD-07 | `session/load` is the only resume path | ACP v1 has no other way to reopen a session on a new process; an agent without it cannot reopen an indexed session | Keeping the transcript in Alchemist and replaying it as a prompt | Decided |
| AD-08 | The ACP host does not enforce `requireExploreBeforeProbe` | Matches the Claude host; the explore gate belongs to the Cursor host's tools | Porting the gate | Decided |
| AD-09 | Model and effort are not persisted across sessions | They are the agent's session config options and their ids differ per agent | Storing them in the session index | Decided |
