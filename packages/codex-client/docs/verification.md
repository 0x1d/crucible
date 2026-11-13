---
id: crucible/packages/codex-client/verification
title: Verification
type: VER
owner: crucible/packages/codex-client
status: Draft
date: 2026-11-13
depends: [crucible/packages/codex-client/requirements, crucible/packages/codex-client/interfaces/library-api, crucible/packages/codex-client/interfaces/command-line]
related: []
planned: []
---

# Verification

**Planned** crucible/P-03

The client is verified by unit tests against a fake framed TCP server, by integration tests that start the real runtime in a temporary state directory, and by the alchemist host tests and evals that run on top of it. Nothing is built yet: every row has the status `not built` and names the test that will prove it. The existing tests in `projects/alchemist/core/elixir-bridge.test.ts` move into the package and cover the lifecycle rows.

## 1 Strategy

| Level | Tool | Command | Runs in |
| --- | --- | --- | --- |
| Unit | `node:test`, fake TCP server | `pnpm test` in `packages/codex-client` | CI |
| Integration | `node:test`, real runtime, needs Elixir on `PATH` | `pnpm test` in `packages/codex-client` | CI (root dev shell) |
| Consumers | Alchemist host tests and evals | `pnpm test`, `pnpm run eval:acp` in `projects/alchemist` | CI; evals manual |

## 2 Traceability

| Requirement | Method | Check | Status |
| --- | --- | --- | --- |
| crucible/packages/codex-client/FR-001 | test | `src/client.test.ts::run returns the runtime result for a call` | not built |
| crucible/packages/codex-client/FR-002 | test | `src/runtime-process.test.ts::first run compiles, starts and writes port, pid and stamp` | not built |
| crucible/packages/codex-client/FR-003 | test | `src/runtime-process.test.ts::two processes on one state directory share the runtime` | not built |
| crucible/packages/codex-client/FR-004 | test | `src/client.test.ts::a killed runtime is replaced and the request retried once` | not built |
| crucible/packages/codex-client/FR-005 | test | `src/client.test.ts::run during stop returns ok false and does not throw` | not built |
| crucible/packages/codex-client/FR-006 | test | `src/client.test.ts::options win over environment over defaults` | not built |
| crucible/packages/codex-client/FR-007 | test | `src/runtime-process.test.ts::attached runtime stops with its owner`, `::detached runtime survives its starter` | not built |
| crucible/packages/codex-client/FR-008 | test | `src/client.test.ts::stop ends the runtime and clears the state files` | not built |
| crucible/packages/codex-client/FR-009 | test | `src/tools.test.ts::four tools with names, schemas and policies` | not built |
| crucible/packages/codex-client/FR-010 | test | `src/tools.test.ts::operations restricts the set`, `::policy is applied per operation` | not built |
| crucible/packages/codex-client/FR-011 | test | `src/tools.test.ts::prepareCall rewrites the request`, `::presentResult replaces the output` | not built |
| crucible/packages/codex-client/FR-012 | test | `src/cli.test.ts::prints one JSON line and exits 0`, `::invalid JSON exits 1` | not built |
| crucible/packages/codex-client/OR-001 | inspection | `package.json` dependencies; no import path containing `projects/` | not built |
| crucible/packages/codex-client/OR-002 | analysis | 100 `echo` calls against a warm runtime, compared with the runtime's own timing (`scripts/measure-call-function.mjs` in alchemist) | not built |
| crucible/packages/codex-client/OR-003 | test | `src/rpc.test.ts::request times out`, `::oversized response is refused` | not built |
| crucible/packages/codex-client/OR-004 | inspection | CI runs the package tests on Node 24 on Linux | not built |

## 3 Manual procedures

### 3.1 Hosts unchanged (crucible/packages/codex-client/G-03)

1. In `projects/alchemist`, run `pnpm run tui` with the Claude host and ask it to call `echo`.
2. Run `pnpm run eval:acp`.
3. Run `agent-sdk validate --dir hosts/cursor`.

**Expected:** the call returns its result in the terminal UI, the eval passes, and the Cursor host validates with the package import (crucible/OI-21).
