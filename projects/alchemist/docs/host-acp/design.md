---
id: crucible/alchemist/host-acp/design
title: Design
type: DES
owner: crucible/alchemist/host-acp
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/architecture/host-adapters]
related: []
planned:
  - id: crucible/alchemist/host-acp/P-01
    title: "ACP client host: remaining phases"
    depends: []
---

# Design

**Planned** P-01.

Status: **In progress** - Phases 0-4 implemented (2026-11-06): `AcpClientAdapter`, MCP-over-ACP codex tools, session index and reload, cancel, and the shared tool definitions for the Claude and ACP hosts.
Phase 5 is pending, and the host is TUI-only until then.

## Goal

Add an **ACP client host** so Alchemist:

1. **Discovers** common CLI coding agents that speak [Agent Client Protocol](https://agentclientprotocol.com) (ACP).
2. **Lists** them for user selection (alongside existing SDK hosts `cursor` and `claude` in the TUI).
3. **Connects** to the chosen agent and **controls the harness** (workspace FS, permissions, turns) as the ACP **Client**.
4. **Exposes Alchemist codex tools** to the external agent via **MCP-over-ACP**, so the remote agent can call `find_function`, `define_function`, `load_function`, and `call_function` (and optional `handoff`) against the same Elixir runtime as other hosts.

Alchemist is not the ACP Agent in this design; the user-selected CLI process is.

## Protocol and SDK

| Item | Choice |
| --- | --- |
| Protocol | ACP v1 (stable) unless a target agent requires v2 experimental |
| Library | `@agentclientprotocol/sdk` - pin **2.4.0** initially ([npm](https://www.npmjs.com/package/@agentclientprotocol/sdk)) |
| Default import | `@agentclientprotocol/sdk` |
| MCP-over-ACP | `@agentclientprotocol/sdk/unstable` - `McpOverAcpProvider`, `methods.client.mcp.message` |
| Stdio transport | `acp.ndJsonStream` + spawned subprocess ([client.ts example](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts)) |
| Optional transports | `@agentclientprotocol/sdk/experimental/http-client`, `ws-client` for agents without stdio ACP |

References:

- [Protocol v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [TypeScript API](https://agentclientprotocol.github.io/typescript-sdk)
- [Examples directory](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
- [MCP-over-ACP client example](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/mcp-over-acp-client.ts)
- Production agent pattern: [Gemini CLI Zed integration](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/zed-integration/zedIntegration.ts)

## Architecture

```
User -> TUI (HostAdapter)
         +- CursorAdapter / ClaudeAdapter (direct SDK)
         +- AcpClientAdapter
                +- ACP Client (@agentclientprotocol/sdk)
                |     +- fs.readTextFile / fs.writeTextFile -> session harness
                |     +- session.requestPermission -> TUI approval
                |     +- sessionUpdate -> HostEvent stream
                +- McpOverAcpProvider (unstable)
                |     +- MCP server "alchemist" -> runCodexOp / HOST_TOOL_NAMES
                +- subprocess or HTTP/WS -> external ACP Agent (CLI)
```

### Fit with existing hosts

The TUI already selects hosts via `HostAdapter` (`tui/adapters/types.ts`). SDK hosts implement `send` -> `AsyncIterable<HostEvent>`. The ACP host implements the same surface; internally it runs the ACP client loop instead of Cursor/Claude SDK APIs.

Shared codex logic should reuse **`runCodexOp`** and **`HOST_TOOL_NAMES`** from `core/protocol.ts`, mirroring `hosts/claude/codex.ts` (and Cursor `bot/tools/*`) rather than duplicating schemas.

## Agent discovery

### Tier 1 - Shipped registry

Data file (e.g. `hosts/acp/registry.json`) listing known agents with:

- `id`, `label`, `probe` (`command`, `args`, success exit code or stdout pattern)
- `spawn` (`command`, `args`, optional `cwd` template)

Only mark **available** after a lightweight `initialize` probe (short timeout), not merely `which`.

### Tier 2 - User config

Merge Zed-compatible entries from e.g. `~/.config/alchemist/acp-agents.json`:

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

### Tier 3 - Optional PATH scan (later)

Allowlisted command names only; never auto-spawn unconfigured binaries.

### UX

- `/host`: group **SDK hosts** vs **ACP agents** (discovered + configured).
- Show protocol version from `initialize` and probe status (ok / failed + reason).

## ACP client responsibilities

| ACP client method | Alchemist behavior |
| --- | --- |
| `fs.readTextFile` / `fs.writeTextFile` | Paths relative to session harness / `repoRoot`; align safety with codex `fs.*` |
| `session.requestPermission` | TUI prompt or host-flags policy (serve: configurable default) |
| `sessionUpdate` | Map to `HostEvent`: `text`, `reasoning`, `tool`, `tool_result`, `usage`, `done`, `error` |
| Cancel (Esc) | `session/cancel` + subprocess teardown on host switch |

Advertise in `initialize` only capabilities Alchemist actually implements.

## Alchemist codex via MCP-over-ACP

External ACP agents must declare **`agentCapabilities.mcpCapabilities.acp`** (see SDK example). Alchemist acts as the **MCP host on the client side** of the ACP connection.

### Wiring (follow SDK example)

1. Import **`@agentclientprotocol/sdk/unstable`** for `McpOverAcpProvider` and `methods.client.mcp.message`.
2. Build an MCP server with **`@modelcontextprotocol/server`** + **`fromMcpServer`** (SDK helper) or equivalent factory.
3. Register tools using **`HOST_TOOL_NAMES`** from `core/protocol.ts`:
   - `find_function` -> `{ op: "find", ... }`
   - `define_function` -> `{ op: "define", ... }`
   - `load_function` -> `{ op: "load", name }`
   - `call_function` -> `{ op: "call", name, args }` with host-flags (`defaultMaxBytes`, `resultDigest`) applied like `hosts/claude/codex.ts` `callWithFlags`.
4. Optional: **`handoff`** tool when `historyReclaim` / handoff flags enabled (same as Claude host).
5. **`mcpProvider.registerServer(agent, { name: "alchemist", handler })`** on the ACP connection **before** `session/new` completes (agent may call tools early).
6. Start session with **`.withMcpServer(tools.declaration)`** so the agent sees `{ type: "acp", name, serverId }`.
7. On teardown: `session.dispose()`, `tools.dispose()`, `connection.close()`, kill subprocess.

### Shared module (implementation target)

Extract or import a single **`alchemistMcpTools()`** factory used by:

- `hosts/claude/codex.ts` (Claude SDK MCP server - today)
- `hosts/cursor/bot/tools/*` (Cursor MCP - today)
- **`hosts/acp/alchemist-mcp.ts`** (MCP-over-ACP for ACP client host - new)

One naming contract (`HOST_TOOL_NAMES`), one bridge to BEAM (`runCodexOp`), one place for zod schemas and result presentation (`presentResult`, caps).

### Agent without MCP-over-ACP

If `initialize` lacks `mcpCapabilities.acp`, still allow chat-only mode but surface a clear TUI warning: codex tools unavailable unless the agent supports client-provided MCP over ACP.

## Sessions and state

- Persist ACP `sessionId` under state root, e.g. `hosts/acp/<agent-id>/sessions/`.
- `listSessions` / `openSession`: use agent `loadSession` when supported; else Alchemist-local session index only.
- Workspace cwd for `buildSession(cwd)`: canonical **session harness dir** (same keying as explore-gate / `call_function` ctx).

## HTTP serve channel

The ACP host is TUI-only until streaming parity with `channels/http.ts` is defined in Phase 5.
`denyPermission` is the headless permission default for that channel.

## Dependencies

```bash
pnpm add @agentclientprotocol/sdk
```

Peer: `zod` (^3.25.76 || ^4.0.0). Optional peer `@modelcontextprotocol/server` for MCP-over-ACP (already used elsewhere in the repo).

## Phases

| Phase | Deliverable |
| --- | --- |
| 0 | This spec; spike: hardcoded agent from SDK `agent.ts`, stdio only |
| 1 | Discovery + config merge; TUI list ACP agents |
| 2 | `AcpClientAdapter` + `HostEvent` mapping + FS/permission handlers |
| 3 | **`alchemistMcpTools` + MCP-over-ACP** on unstable import; eval with `mcp-over-acp-agent.ts` |
| 4 | Session persistence, cancel, lifecycle; shared factory refactor from Claude/Cursor |
| 5 | HTTP/WS agents; serve channel; v2 only if required |

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Alchemist role on wire | ACP **Client** | User picks external CLI **Agent**; matches Zed/editor model |
| Codex tool transport to agent | **MCP-over-ACP** (client-provided MCP) | Official SDK path; agent keeps native tools + gains codex |
| Tool names | `HOST_TOOL_NAMES` / shared factory | Same contract as Claude and Cursor hosts |
| MCP SDK import for ACP | `@agentclientprotocol/sdk/unstable` | `McpOverAcpProvider` not on stable v1 entry yet |
| Discovery | Registry + user config; probe via `initialize` | Avoid false positives from PATH alone |
| Location | `hosts/acp/` | Beside `hosts/claude/`, `hosts/cursor/` |

## Implementation notes

- `hosts/shared/codex-tools.ts` holds the tool definitions used by the Claude and ACP hosts.
- The Cursor tools in `hosts/cursor/bot/tools/` stay separate, because they depend on `ToolContext`, `capToolResult`, and the explore gate.
- The ACP host does not enforce `requireExploreBeforeProbe`, which matches the Claude host.
- A session cwd is `hosts/acp/.sessions/<uuid>`, because the agent assigns the session id only after it receives the cwd.
- Session state is `hosts/acp/.agent-serve/agents/<agent-id>/sessions.json`.
- Model and effort come from the session `configOptions`, and they are not persisted across sessions.
- `session/load` is the only resume path, and an agent without it cannot reopen an indexed session.

## Risks

- **Capability matrix**: Not all CLI agents implement MCP-over-ACP; feature-detect and degrade gracefully.
- **Dual tool stacks**: External agent tools vs Alchemist codex - product default is both available when supported.
- **Unstable API**: MCP-over-ACP may move; pin SDK and follow migration guide on upgrades.
- **Permissions**: Headless serve needs policy for `requestPermission` and MCP tool side effects (`define_function`).

## Success criteria

- User selects a discovered ACP agent in TUI, sends a prompt, sees streaming `HostEvent`s.
- Agent with `mcpCapabilities.acp` successfully calls `call_function` on a codex slug (e.g. `memory.overview`) and receives capped JSON.
- No regression to `cursor` / `claude` SDK hosts.

## Related memory

- `decision/acp-host-spec`
- `decision/acp-codex-mcp-over-acp`
