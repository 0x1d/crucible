---
id: crucible/alchemist/host-cursor/design
title: Design
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
depends: [crucible/alchemist/architecture/host-adapters]
related: [crucible/alchemist/host-cursor/decisions]
planned: []
---

# Design

The Cursor host runs the Alchemist codex in a Cursor agent served by `@grok/agent-sdk`. The agent definition, its instructions, the four codex tools and the `handoff` tool live under `hosts/cursor/bot/`; the terminal UI drives it through `tui/adapters/cursor.ts`. Because the Cursor agent store keeps every turn and cannot be shortened, most of the host's design is about context: small tool results, a small always-on prompt, a reusable cached prefix, and a handoff into a new session when the window fills. Each of these is a sub-document below.

## 1 Module structure

| Module | Path | Responsibility |
| --- | --- | --- |
| Agent | `hosts/cursor/bot/agent.ts`, `model.ts`, `lib/agent-model.ts` | Agent definition: MCP tools only, `.sessions` workspaces, the model chosen at start |
| Instructions | `hosts/cursor/bot/instructions.md`, `skills/codex.md`, `skills/memory.md` | The always-on prompt and the on-demand skills |
| Codex tools | `hosts/cursor/bot/tools/{find,define,load,call}_function.ts`, `lib/codex-tool.ts`, `lib/elixir-bridge.ts` | The four codex tools against the runtime |
| Handoff tool | `hosts/cursor/bot/tools/handoff.ts`, `lib/handoff.ts` | Writes `handoff.md` |
| Result shaping | `hosts/cursor/bot/lib/cap-tool-result.ts`, `result-digest.ts`, `tool-result-log.ts` | Digest and log of tool results |
| Explore gate | `hosts/cursor/bot/lib/explore-gate.ts`, `hooks/explore-gate.ts` | Blocks raw probes until `explore` runs |
| Memory | `hosts/cursor/bot/hooks/memory.ts`, `hooks/auto-memory-retain.ts`, `lib/memory-recall-before-explore.ts`, `lib/auto-memory-retain-kv.ts`, `lib/remember-prompt.ts` | Memory journal hook, recall block, auto retain |
| HTTP channel | `hosts/cursor/bot/channels/http.ts` | Adds the recall block to inbound messages |
| Host flags | `hosts/cursor/bot/lib/host-flags.ts`, `tui/host-flags.ts` | Flag file, defaults, `/flags` |
| Session workspace | `hosts/cursor/bot/lib/session-workspace.ts` | `hosts/cursor/.sessions/<id>/` per session |
| TUI adapter | `tui/adapters/cursor.ts`, `tui/adapters/handoff.ts` | Serve process, sessions, event mapping, usage, handoff fork |
| Evals | `hosts/cursor/evals/` | `context-size`, `prompt-cache`, `handoff`, `smoke`, `memory`, `memory-time`, `session_trace` |

## 2 Sub-documents

| Sub-document | Content | Planned |
| --- | --- | --- |
| [crucible/alchemist/host-cursor/design/host-flags](design/host-flags.md) | Flag file, defaults, overrides, the exclusive history reclaim mode | - |
| [crucible/alchemist/host-cursor/design/tool-results](design/tool-results.md) | Digest of large tool results, default caps, agent-sized codex defaults, the size log | - |
| [crucible/alchemist/host-cursor/design/context-budget](design/context-budget.md) | What a prompt is made of, the always-on rules, the footer, the eval budgets | crucible/alchemist/host-cursor/P-04 |
| [crucible/alchemist/host-cursor/design/prompt-cache](design/prompt-cache.md) | Model choice at start, the pinned model, the static prefix, the cache gate | - |
| [crucible/alchemist/host-cursor/design/context-handoff](design/context-handoff.md) | The `handoff` tool, the fork route and the session chain | - |
| [crucible/alchemist/host-cursor/design/explore-and-memory](design/explore-and-memory.md) | The `explore` entry, the explore gate, memory recall and auto retain | crucible/alchemist/host-cursor/P-05 |

## 3 State

| Path | Contents |
| --- | --- |
| `hosts/cursor/.sessions/<id>/` | Session workspace, its own git root; `handoff.md` and `artifacts/` live here |
| `hosts/cursor/.agent-serve/host-flags.json` | Host flags |
| `hosts/cursor/.agent-serve/handoff-chain.json` | Forks from old to new session id |
| `hosts/cursor/.agent-serve/context-tool-sizes.log` | Tool result sizes, while `toolResultLog` is on |

## 4 Error handling

| Failure | Response |
| --- | --- |
| Runtime not reachable (`spawn elixir ENOENT`) | The tool call fails; the failure stays in the transcript |
| A raw probe while the explore gate is closed | The call returns an error naming `explore` |
| Handoff over its cap | The tool fails and writes nothing |
| Compact turn without a successful handoff | The user's message is not sent, and the next send tries again |
