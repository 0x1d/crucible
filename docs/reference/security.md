# Security

This page describes the **current** trust boundary for the codex. It does not
document sandboxing or multi-tenant isolation because those are not implemented.

## Arbitrary code

The `define` operation writes Elixir source to disk and compiles it immediately.
`load` and `call` compile and execute entry modules and their dependencies.

Compilation and execution run inside the long-lived BEAM on the host machine with
that process's operating-system identity and environment.

## Host environment inheritance

The Node bridge runs `mix compile` and spawns `elixir --no-halt` with
`env: { ...process.env, ... }`. Codex operations therefore inherit environment
variables, file-system access, and network reachability available to the parent
host process unless the host restricts them separately.

## Trust model

Treat codex access as **equivalent to shell access** for the user running the
host adapter or CLI:

- Only trusted principals should invoke `define`, `load`, or `call`.
- Untrusted model output must not reach `define` without human review in
  high-risk deployments.
- Do not store secrets in entry source; they would be visible on disk and in
  version control.

## Composition and secrets

Codex entries may call other entries through static composition or
`AgentFn.Codex.call/2`. Each call runs in the same trust domain. There is no
credential vault inside the codex.

## Service gateway

`Runtime.ServiceGateway` listens on `127.0.0.1` beside the codex socket and accepts only `call`.
It runs only `services.*` entries listed in the service manifest with the SHA-256 of their current `tool.ex`.
Input and output are validated against the entry's JSON Schemas, and each call runs in a task with a timeout and a `max_heap_size`.
The entry still runs with the BEAM's full privileges; the gateway limits which code a caller can reach, not what that code can do.

## Future hardening

Connection tasks isolate a crashed `run/1` from the listen socket. They do not
provide an operating-system sandbox. Stronger isolation (separate OS users,
containers, network policy) would be an architectural addition on top of the
long-lived BEAM. No such layer ships in this repository today.

## Related reading

- [Codex protocol](./protocol.md)
- [Authoring codex entries](../guides/authoring-entries.md)
- [Host adapters](./hosts.md)
