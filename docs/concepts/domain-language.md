# Domain language

This reference defines the terms used for Alchemist's product and implementation
boundaries.

## Canonical terms

| Term | Meaning |
| --- | --- |
| Alchemist | The product: a host-independent agent harness. Hosts share the codex. Memory and the long-lived runtime sit beside it. |
| Codex | The capability layer: the tree under `functions/`, its metadata, and the operations `define`, `load`, `find`, and `call`. |
| Codex entry | A slug-addressed capability implemented by an `AgentFn.*` module that exports `run/1`. |
| Slug | The canonical dot-separated address for a codex entry. Each segment uses `snake_case`; the address maps to a directory path and an Elixir module name. For example, `data.pipeline` maps to `functions/data/pipeline/` and `AgentFn.Data.Pipeline`. |
| Codex protocol | The JSON operations `define`, `load`, `find`, and `call`. |
| Codex tool | A model-facing alias for one codex operation, such as `call_function` for `call`. |
| Host | An environment that runs an agent and reaches the codex through the protocol. |
| Host adapter | Code that maps a host's tool API to codex operations. |
| Runtime | The `:runtime` OTP application. It validates slugs, compiles entry sources into the live BEAM, discovers metadata, invokes `run/1`, and owns memory. Hosts reach it over TCP. Mix only builds it. |
| `runtime/` Mix project | Source and tests for the runtime (`mix compile`, `mix test`). Not the live service. |
| Entry module | The `AgentFn.*` module that matches a slug and exports `run/1`. |
| Deep module | Supporting code beneath one codex entry's source tree. A deep module is part of that entry's implementation rather than a separately addressed codex entry. |
| Shared library | `AgentLib.*` code under `functions/lib/` that can be used by multiple codex entries. |
| Static composition | Direct Elixir module calls when the dependency is known while authoring the entry. |
| Dynamic dispatch | A call through `AgentFn.Codex.call/2` when a slug is runtime data. |
| Memory | The MiniGraf database owned by `Runtime.Memory`. Codex entries `memory.transact`, `memory.retract`, `memory.query`, `memory.overview`, and `memory.remember` are its interface. |

## Disambiguation

| Name | Boundary |
| --- | --- |
| Codex | The capability tree, metadata, and protocol contract. One component of Alchemist. |
| `Runtime.Codex` | Runtime module that maps slugs to filesystem paths and modules, stores metadata, and discovers entries. |
| `AgentFn.Codex` | The Elixir API available to capability code for listing entries and dynamically dispatching a runtime slug. |
| Codex entry | A capability addressed by a slug and implemented by its matching entry module. |
| Codex tool | A host-visible alias that submits one codex protocol operation. It is not a capability implementation. |
| `AgentFn.Tool` | The Elixir behaviour that declares the `run/1` callback for entry modules. It is not a host-visible tool or a codex entry. |
| Runtime | The `:runtime` OTP application on the long-lived BEAM. It serves codex operations and owns memory. |
| `runtime/` | Mix project whose compiled OTP application is the Alchemist runtime. |
| Memory | MiniGraf database at `memory/minigraf.graph`. It is not the Cursor host journal in `hosts/cursor/bot/hooks/memory.ts`. |
| Long-lived BEAM | The `elixir --no-halt` process started by the Node bridge. It runs the runtime application: `Runtime.Memory`, a task supervisor, `Runtime.Server` (compile serializer), and a permanent acceptor. It serves many codex operations until restart (for example when `runtime/` sources change, the supervisor hits its restart limit, or the bridge recovers from a transport error). |
