# Domain language

This reference defines the terms used for Alchemist's product and implementation
boundaries.

## Canonical terms

| Term | Meaning |
| --- | --- |
| Alchemist | The product: a host-independent Elixir capability registry. |
| Registry | The capability tree, its metadata, and the four-operation contract used to define, load, find, and call capabilities. |
| Registry entry | A slug-addressed capability implemented by an `AgentFn.*` module that exports `run/1`. |
| Slug | The canonical dot-separated address for a registry entry. Each segment uses `snake_case`; the address maps to a directory path and an Elixir module name. For example, `data.pipeline` maps to `functions/data/pipeline/` and `AgentFn.Data.Pipeline`. |
| Registry protocol | The JSON operations `define`, `load`, `find`, and `call`. |
| Harness tool | A model-facing alias for one registry operation, such as `call-function` for `call`. |
| Host | An environment that exposes the registry protocol. |
| Host adapter | Code that maps a host's tool API to registry operations. |
| Registry runtime | The `:runtime` OTP application that validates slugs, compiles entry sources into the live BEAM, discovers metadata, and invokes `run/1`. Hosts reach it over TCP; Mix only builds it. |
| `runtime/` Mix project | Source and tests for the registry runtime (`mix compile`, `mix test`). Not the live service. |
| Entry module | The `AgentFn.*` module that matches a slug and exports `run/1`. |
| Deep module | Supporting code beneath one registry entry's source tree. A deep module is part of that entry's implementation rather than a separately addressed registry entry. |
| Shared library | `AgentLib.*` code under `functions/lib/` that can be used by multiple registry entries. |
| Static composition | Direct Elixir module calls when the dependency is known while authoring the entry. |
| Dynamic dispatch | A call through `AgentFn.Registry.call/2` when a slug is runtime data. |

## Disambiguation

| Name | Boundary |
| --- | --- |
| Registry | The product-level capability tree, metadata, and protocol contract. |
| `Runtime.Registry` | Registry-runtime module that maps slugs to filesystem paths and modules, stores metadata, and discovers entries. |
| `AgentFn.Registry` | The Elixir API available to capability code for listing entries and dynamically dispatching a runtime slug. |
| Registry entry | A capability addressed by a slug and implemented by its matching entry module. |
| Harness tool | A host-visible alias that submits one registry protocol operation. It is not a capability implementation. |
| `AgentFn.Tool` | The Elixir behaviour that declares the `run/1` callback for entry modules. It is not a host-visible tool or a registry entry. |
| `runtime/` | Mix project whose compiled OTP application is the registry runtime. |
| Long-lived BEAM | The `elixir --no-halt` process started by the Node bridge. It runs the runtime application: a task supervisor, `Runtime.Server` (compile serializer), and a permanent acceptor. It serves many registry operations until restart (for example when `runtime/` sources change, the supervisor hits its restart limit, or the bridge recovers from a transport error). |
