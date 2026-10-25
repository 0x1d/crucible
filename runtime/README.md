# Mix control plane

The `runtime/` Mix project validates, compiles, discovers, and invokes registry
entries under `functions/`. The Node bridge (`core/elixir-bridge.ts`) boots a
long-lived `elixir` process running `Runtime.Server`, which keeps compiled entry
modules loaded between registry operations.

## Development

```bash
mix deps.get
mix test
```

Registry JSON operations are dispatched through `Runtime.CLI` inside the
server BEAM. See [Host adapters](../docs/reference/hosts.md) and
[Domain language](../docs/concepts/domain-language.md) for product boundaries.

Environment variable `AGENT_FUNCTIONS_DIR` overrides the default `functions/`
directory when set. `ALCHEMIST_STATE_DIR` overrides the bridge state directory
(default `runtime/.alchemist`).
