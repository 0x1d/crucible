---
id: crucible/alchemist/host-claude/design
title: Design
type: DES
owner: crucible/alchemist/host-claude
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/architecture/host-adapters]
related: []
planned: []
---

# Design

Status: Implemented on 2026-10-26.

## Goal

Add a second example host next to the Cursor adapter.
The host runs the Alchemist codex through the Claude Agent SDK with a minimal system prompt, an interactive loop, and evals.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Location | `hosts/claude/` | Sits beside `hosts/cursor/`, the Cursor adapter, and leaves room for other hosts. |
| Tool transport | In-process MCP server via `createSdkMcpServer` | No extra process. Tool handlers call `runCodexOp()` directly. |
| Tool names | `HOST_TOOL_NAMES` from `core/protocol.ts` | One naming contract across hosts. |
| System prompt | `hosts/claude/instructions.md` as a plain string | Minimal prompt. The Claude Code preset is not loaded. |
| Built-in tools | `tools: []` | Claude sees only the four codex tools. |
| Permissions | `allowedTools` with `mcp__alchemist__*` names and `permissionMode: "default"` | No prompts and no `bypassPermissions`. |
| Settings | `settingSources: []` | Host behavior does not depend on local Claude Code settings. |
| Multi-turn chat | One `query()` per turn with `resume: sessionId` | Simplest multi-turn form in the SDK. |
| Evals | `node:test` files under `hosts/claude/evals/` | The Cursor eval framework is tied to `@grok/agent-sdk`. |
| Dependency | `@anthropic-ai/claude-agent-sdk` | Required by the host. The only new npm dependency. |

## Out of scope

- Channels, deployment, and hooks from the Claude Agent SDK.
- Streaming partial output in the chat loop.
- A shared eval framework across hosts.
