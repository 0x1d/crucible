# Alchemist

Alchemist is a host-independent Elixir capability codex.
Hosts expose a fixed four-operation JSON protocol.
Capabilities live in an Elixir source tree under `functions/`, each entry implemented by an `AgentFn.*` module with `run/1`.

## Architecture

```mermaid
flowchart LR
  Host["Host environment"]
  Adapter["Host adapter or CLI"]
  Bridge["Node bridge\n(core/elixir-bridge.ts)"]
  Beam["Long-lived BEAM\n(:runtime app)"]
  Tree["Codex tree\n(functions/)"]

  Host --> Adapter
  Adapter --> Bridge
  Bridge --> Beam
  Beam --> Tree
```

The codex protocol operations are `define`, `load`, `find`, and `call`.
A long-lived BEAM (`elixir --no-halt`) runs the runtime application as permanent.
Compiled entry modules stay loaded across operations.
`Runtime.Application` supervises connection tasks, a compile serializer, and a permanent acceptor.
Live node files (`port`, `pid`, and the bridge's `stamp`) are under `runtime/.alchemist/` unless `ALCHEMIST_STATE_DIR` is set.
Model-facing harness tools in the Cursor adapter and the Claude Agent SDK host map one-to-one to those operations.
Other hosts call the same operations through `scripts/cli.mjs` or a thin wrapper.

## Quick start

Prerequisites: Node 24+ (Cursor adapter and Claude host) and Elixir 1.20+.

```bash
mix local.hex --force && mix local.rebar --force
(cd runtime && mix deps.get)
npm ci
npm run check
node scripts/cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'
```

Optional Cursor development:

```bash
npm run dev
```

Optional Claude Agent SDK host:

```bash
npm run chat:claude
npm run eval:claude
```

## Documentation

- [Documentation index](docs/index.md) — goal-oriented reading paths
- [Getting started](docs/guides/getting-started.md) — install, validate, first call
- [Architecture](docs/concepts/architecture.md) — components, lifecycle, composition
- [Memory](docs/concepts/memory.md) — MiniGraf memory and bi-temporal queries
- [Codex protocol](docs/reference/protocol.md) — operation contracts

## Security

`define` accepts arbitrary Elixir source and executes with the privileges of the long-lived BEAM process on the host.
Restrict codex access to trusted users and inputs.
See [Security boundary](docs/reference/security.md).

## License

MIT
