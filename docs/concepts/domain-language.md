# Domain language

This reference defines the terms used for Alchemist's product and implementation
boundaries.

## Canonical terms

| Term | Meaning |
| --- | --- |
| Alchemist | The product: a host-independent Elixir capability codex. |
| Codex | The capability tree, its metadata, and the four-operation contract used to define, load, find, and call capabilities. |
| Codex entry | A slug-addressed capability implemented by an `AgentFn.*` module that exports `run/1`. |
| Slug | The canonical dot-separated address for a codex entry. Each segment uses `snake_case`; the address maps to a directory path and an Elixir module name. For example, `data.pipeline` maps to `functions/data/pipeline/` and `AgentFn.Data.Pipeline`. |
| Codex protocol | The JSON operations `define`, `load`, `find`, and `call`. |
| Harness tool | A model-facing alias for one codex operation, such as `call-function` for `call`. |
| Host | An environment that exposes the codex protocol. |
| Host adapter | Code that maps a host's tool API to codex operations. |
| Mix control plane | The `runtime/` Mix project, which validates, compiles, discovers, and invokes codex entries. |
| Entry module | The `AgentFn.*` module that matches a slug and exports `run/1`. |
| Deep module | Supporting code beneath one codex entry's source tree. A deep module is part of that entry's implementation rather than a separately addressed codex entry. |
| Shared library | `AgentLib.*` code under `functions/lib/` that can be used by multiple codex entries. |
| Static composition | Direct Elixir module calls when the dependency is known while authoring the entry. |
| Dynamic dispatch | A call through `AgentFn.Codex.call/2` when a slug is runtime data. |

## Disambiguation

| Name | Boundary |
| --- | --- |
| Codex | The product-level capability tree, metadata, and protocol contract. |
| `Runtime.Codex` | The Mix control-plane module that maps slugs to filesystem paths and modules, stores metadata, and discovers entries. |
| `AgentFn.Codex` | The Elixir API available to capability code for listing entries and dynamically dispatching a runtime slug. |
| Codex entry | A capability addressed by a slug and implemented by its matching entry module. |
| Harness tool | A host-visible alias that submits one codex protocol operation. It is not a capability implementation. |
| `AgentFn.Tool` | The Elixir behaviour that declares the `run/1` callback for entry modules. It is not a host-visible tool or a codex entry. |
| `runtime/` | The Mix project containing the control-plane modules and CLI. |
| Long-lived BEAM | The `elixir --no-halt` process started by the Node bridge. It runs the runtime application: a task supervisor, `Runtime.Server` (compile serializer), and a permanent acceptor. It serves many codex operations until restart (for example when `runtime/` sources change, the supervisor hits its restart limit, or the bridge recovers from a transport error). |
