---
id: crucible/packages/codex-client/requirements
title: Requirements
type: REQ
owner: crucible/packages/codex-client
status: Draft
date: 2026-11-13
depends: [crucible/requirements, crucible/architecture/shared-packages, crucible/alchemist/codex-protocol/interfaces/codex-protocol]
related: [crucible/increments/repository-and-migration]
planned: []
---

# Requirements

**Planned** crucible/P-03

The codex client gives every TypeScript consumer the same access to the codex runtime: one call that sends a codex request and returns its result, with the runtime started, compiled and reused behind it. It adds the four operations as agent tools and a command for scripts. It holds no host policy and no dependency on an agent SDK.

## 1 Purpose

Three alchemist hosts, the terminal UI and two scripts import the bridge from `projects/alchemist/core/`, and homunculus needs the same access for crucible/CH-4. The bridge finds the runtime by its own file location and takes a type from `@grok/agent-sdk`, so it cannot be used from outside alchemist. The package removes both ties (crucible/AD-15).

## 2 Scope

| In scope | Out of scope |
| --- | --- |
| Starting, reusing, replacing and stopping the BEAM for a state directory | The runtime itself: crucible/alchemist/runtime |
| Sending a codex request and returning its result | The meaning of the operations: crucible/alchemist/codex-protocol |
| The four operations as agent tools with schemas | Host flags, result digest, result caps, the handoff tool: alchemist hosts today, `packages/agent` with crucible/P-05 |
| A command that sends one request | Registering tools on an MCP server or an agent session: the consumer |
| | A client for Bun: athanor reaches alchemist through the sidecar (crucible/CH-1, crucible/OI-06) |

## 3 Users and actors

| Actor | Kind | Goal |
| --- | --- | --- |
| Alchemist host or terminal UI | component | Give its agent the codex tools; call codex entries itself |
| Homunculus server | component | Give the voice agent `find` and `call` (crucible/CH-4) |
| Developer or script | person | Send one codex request from a shell |
| Codex runtime | component | Receive requests on loopback; run as one process per state directory |

## 4 Goals

| Id | Goal |
| --- | --- |
| G-01 | One implementation of codex access for all TypeScript consumers (crucible/requirements section 4) |
| G-02 | Usable from any workspace package or project without importing from `projects/alchemist/` |
| G-03 | No behaviour change for the alchemist hosts |
| G-04 | A consumer gets the codex tools without writing schemas or names itself |

## 5 Functional requirements

| Id | Requirement | Acceptance | Priority | Goal |
| --- | --- | --- | --- | --- |
| FR-001 | When a consumer sends a codex request, the client shall return the runtime's JSON result for it. | `run({ op: "call", name: "echo", args })` returns `ok: true` with the echoed arguments | must | crucible/packages/codex-client/G-01 |
| FR-002 | When no healthy runtime exists for the state directory, the client shall compile the runtime if its sources changed, start it, and wait until it accepts requests. | First `run` on an empty state directory succeeds; `port`, `pid` and `stamp` exist afterwards | must | crucible/packages/codex-client/G-01 |
| FR-003 | While a healthy runtime exists for the state directory, the client shall reuse it, also when another process started it. | Two processes with the same state directory report the same runtime pid | must | crucible/packages/codex-client/G-01 |
| FR-004 | If a request fails at the transport, then the client shall replace the runtime and send the request once more. | Killing the BEAM between two calls; the second call succeeds | must | crucible/packages/codex-client/G-03 |
| FR-005 | If a request cannot be completed, then the client shall return `ok: false` with an error text and shall not throw. | A request sent while the client is stopping returns `ok: false` | must | crucible/packages/codex-client/G-03 |
| FR-006 | The client shall take the runtime directory, the functions directory and the state directory from its options, then from the environment, then from defaults. | A client created with `runtimeDir` in a temporary copy uses that copy | must | crucible/packages/codex-client/G-02 |
| FR-007 | While the client runs attached, the runtime shall stop when the consuming process exits; while it runs detached, the runtime shall keep running. | Attached: the BEAM pid is gone after the process exits. Detached: it is alive | must | crucible/packages/codex-client/G-03 |
| FR-008 | When a consumer stops the client, the client shall stop the runtime it recorded and clear the state files. | After `stop()`, `port` and `pid` are absent and the pid is not alive | must | crucible/packages/codex-client/G-03 |
| FR-009 | The package shall provide the four operations as tools, each with a name, a description, a JSON Schema, a policy and a call function. | `codexTools(client)` returns four tools named `find_function`, `define_function`, `load_function`, `call_function` | must | crucible/packages/codex-client/G-04 |
| FR-010 | The tool set shall be restrictable to a subset of the operations and shall take a policy per operation. | `codexTools(client, { operations: ["find", "call"] })` returns two tools; `policy: { define: "ask" }` is reflected on the tool | must | crucible/packages/codex-client/G-04 |
| FR-011 | When a consumer supplies call hooks, the `call_function` tool shall apply `prepareCall` to its input before the request and `presentResult` to the result before it is returned. | A hook that stamps a session id is visible in the request; a hook that shortens the result is visible in the tool output | must | crucible/packages/codex-client/G-03 |
| FR-012 | The package shall provide a command that sends one JSON request and prints the JSON result on one line. | `codex '{"op":"find","query":"echo"}'` prints one JSON object and exits 0 | must | crucible/packages/codex-client/G-01 |

## 6 Operational requirements

| Id | Quality | Requirement | Measure |
| --- | --- | --- | --- |
| OR-001 | dependencies | The package depends on Node built-ins and `zod` only, and imports nothing from `projects/` | Inspection of `package.json` and the import graph |
| OR-002 | latency | A request to a running runtime adds at most 5 ms over the runtime's own time | p50 of 100 `echo` calls on loopback, runtime warm |
| OR-003 | limits | A request times out after 120 s; starting the runtime times out after 120 s; a response over 10 MB is refused | Unit tests with a slow and an oversized fake server |
| OR-004 | portability | Runs on Node >= 24 on Linux and macOS, with TypeScript sources loaded directly | CI on Linux; manual on macOS |

## 7 Constraints

| Constraint | Source |
| --- | --- |
| Node, never Bun | crucible/C-03 |
| One BEAM per state directory; requests go to loopback TCP with 4-byte length framing | crucible/alchemist/codex-protocol/interfaces/codex-protocol |
| `define` compiles and runs arbitrary Elixir with the privileges of the BEAM; the tool set must allow leaving it out or asking | crucible/C-01, crucible/AD-21 |
| Package name `@crucible/codex-client` | crucible/AD-25 |
| Elixir and Mix are on `PATH` of the consuming process | crucible/development |

## 8 Assumptions

- The Cursor host's build resolves a workspace package (crucible/OI-21).
- Consumers that need the tool shape of `packages/agent` can use `CodexTool` as it is, because the two have the same structure (crucible/OI-20).

## 9 Terminology

| Term | Meaning |
| --- | --- |
| Runtime | The long-lived BEAM process that serves the codex: `elixir --no-halt` on the Mix project `projects/alchemist/runtime` |
| State directory | The directory that identifies one runtime: it holds `port`, `pid`, `stamp`, `boot.log` and the lock |
| Attached | The runtime stops with the process that started it |
| Detached | The runtime outlives the process that started it |
| Codex request | One of the four operations `define`, `load`, `find`, `call` as a JSON object |
