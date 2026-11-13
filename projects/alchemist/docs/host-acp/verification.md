---
id: crucible/alchemist/host-acp/verification
title: Verification
type: VER
owner: crucible/alchemist/host-acp
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/host-acp/requirements, crucible/alchemist/host-acp/interfaces/agent-client-protocol]
related: []
planned: []
---

# Verification

The ACP host is verified by unit tests of discovery, probe and harness, by adapter tests that run the scripted agent `hosts/acp/mcp-over-acp-agent.ts` and the plain agent `hosts/acp/agent.ts` as real subprocesses, and by one eval that reaches the Alchemist runtime. Four requirements and one conformance rule have no check yet; they are listed as missing.

## 1 Strategy

| Level | Tool | Command | Runs in |
| --- | --- | --- | --- |
| Unit | `node:test` | `pnpm test` in `projects/alchemist` | CI |
| Integration | `node:test` with the example agents as subprocesses | `pnpm test` in `projects/alchemist` | CI |
| End-to-end | `node:test`, needs Elixir on `PATH` | `pnpm run eval:acp` | Manual |
| Manual | Terminal UI | Section 3 | Before a release |

Test files: `hosts/acp/discovery.test.ts`, `hosts/acp/probe.test.ts`, `hosts/acp/harness.test.ts`, `tui/adapters/acp.test.ts`, `hosts/acp/evals/mcp-over-acp.eval.ts`.

## 2 Traceability

| Requirement | Method | Check | Status |
| --- | --- | --- | --- |
| crucible/alchemist/host-acp/FR-001 | test | `hosts/acp/discovery.test.ts::mergeAgentLists overrides registry id with user entry` | pass |
| crucible/alchemist/host-acp/FR-002 | test | `hosts/acp/discovery.test.ts::substituteWorkspace replaces template token`, `::resolveSpawnSpec applies workspace to args and cwd` | pass |
| crucible/alchemist/host-acp/FR-003 | test | `hosts/acp/probe.test.ts::probeSpawnedAgent reads MCP-over-ACP from initialize`, `::probeSpawnedAgent reports a missing binary as a failure`, `::formatProbeDescription ok includes protocol and MCP-over-ACP`, `::formatProbeDescription failed includes reason` | pass |
| crucible/alchemist/host-acp/FR-004 | demo | Section 3.1 | missing |
| crucible/alchemist/host-acp/FR-005 | test | `tui/adapters/acp.test.ts::the session cwd is a harness directory, and fs stays inside the roots` | pass |
| crucible/alchemist/host-acp/FR-006 | test | `tui/adapters/acp.test.ts::a turn streams events and finishes with done` | pass |
| crucible/alchemist/host-acp/FR-007 | test | No test sends a stop reason other than `end_turn` and `cancelled` | missing |
| crucible/alchemist/host-acp/FR-008 | test | `tui/adapters/acp.test.ts::mapper reports a tool call and its result once`, `::mapper starts a tool from an update it has not seen` | pass |
| crucible/alchemist/host-acp/FR-009 | test | `tui/adapters/acp.test.ts::mapper counts only USD cost and surfaces error notices` | pass |
| crucible/alchemist/host-acp/FR-010 | test | `hosts/acp/harness.test.ts::read returns a 1-based line range`, `::write creates parent directories inside a root`, `::paths outside the roots are refused`, `::a symlink cannot leave the roots`, `::a missing file is reported as not found`; `tui/adapters/acp.test.ts::the session cwd is a harness directory, and fs stays inside the roots` | pass |
| crucible/alchemist/host-acp/FR-011 | test | `tui/adapters/acp.test.ts::permission requests go to the handler`; the dialog: section 3.2 | pass |
| crucible/alchemist/host-acp/FR-012 | test | `tui/adapters/acp.test.ts::without a handler, permission requests are refused` | pass |
| crucible/alchemist/host-acp/FR-013 | test | `tui/adapters/acp.test.ts::MCP-over-ACP lists the codex tools` | pass |
| crucible/alchemist/host-acp/FR-014 | test | `tui/adapters/acp.test.ts::MCP-over-ACP lists the codex tools` | pass |
| crucible/alchemist/host-acp/FR-015 | test | `hosts/acp/evals/mcp-over-acp.eval.ts::call_function reaches the codex through MCP-over-ACP` | pass |
| crucible/alchemist/host-acp/FR-016 | test | `tui/adapters/acp.test.ts::an agent without MCP-over-ACP runs chat-only with a notice`, `::an agent without MCP-over-ACP skips the handoff route over budget` | pass |
| crucible/alchemist/host-acp/FR-017 | test | `tui/adapters/acp.test.ts::stopping a turn cancels it and keeps the session usable`, `::stopping a turn answers a pending permission request as cancelled`, `::a turn stopped before it starts refuses permission without asking` | pass |
| crucible/alchemist/host-acp/FR-018 | test | `tui/adapters/acp.test.ts::session index keeps the first prompt as the title`, `::a turn streams events and finishes with done` | pass |
| crucible/alchemist/host-acp/FR-019 | test | `tui/adapters/acp.test.ts::loading a session replays it on the same connection`, `::replayed user chunks merge into one message`, `::an agent without MCP-over-ACP runs chat-only with a notice` | pass |
| crucible/alchemist/host-acp/FR-020 | test | `tui/adapters/acp.test.ts::an agent that dies mid-turn reports an error and the next turn starts over` | pass |
| crucible/alchemist/host-acp/FR-021 | test | `tui/adapters/acp.test.ts::a missing binary fails the session without crashing` | pass |
| crucible/alchemist/host-acp/FR-022 | test | `tui/adapters/acp.test.ts::models and effort come from session config options` | pass |
| crucible/alchemist/host-acp/FR-023 | test | `tui/adapters/acp.test.ts::a successful handoff forks the next prompt into a new seeded session`, `::over the context budget, a turn without a handoff stops with an error` | pass |
| crucible/alchemist/host-acp/FR-024 | inspection | `hosts/acp/spawn.ts`: stderr is piped and written with `console.error` | pass |
| crucible/alchemist/host-acp/OR-001 | test | No test runs an agent that never answers `initialize` | missing |
| crucible/alchemist/host-acp/OR-002 | test | No test runs an agent that ignores `session/cancel` | missing |
| crucible/alchemist/host-acp/CF-01 | test | Every adapter test runs its agent over stdio; the probe test checks `initialize` | pass |
| crucible/alchemist/host-acp/CF-02 | inspection | Agent-side rule; checked for the example agents by reading `hosts/acp/mcp-over-acp-agent.ts` | missing |
| crucible/alchemist/host-acp/CF-03 | test | `tui/adapters/acp.test.ts::loading a session replays it on the same connection`, for the scripted agent | pass |
| crucible/alchemist/host-acp/CF-04 | test | `tui/adapters/acp.test.ts::stopping a turn cancels it and keeps the session usable`, for the scripted agent | pass |

## 3 Manual procedures

### 3.1 Unavailable agent (crucible/alchemist/host-acp/FR-004)

1. Add an entry with `"command": "alchemist-no-such-agent"` to `~/.config/alchemist/acp-agents.json`.
2. Run `pnpm run tui` and open the host dialog.
3. Select the entry.

**Expected:** The dialog shows the entry as `failed` with "cannot start alchemist-no-such-agent", and selecting it prints that the agent is unavailable, with the same reason.

### 3.2 Permission dialog (crucible/alchemist/host-acp/FR-011)

1. Run `pnpm run tui` and select "ACP scripted agent (MCP-over-ACP)".
2. Send `ask`.

**Expected:** A dialog titled "Allow: Delete everything" lists "Allow" and "Reject"; the chosen option id (`yes` or `no`) is shown as the tool result.
