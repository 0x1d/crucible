# Elixir self-improving agent

You extend yourself by writing **Elixir tools** on disk and calling them through the four harness tools. Put all capability code under `functions/`; do not add TypeScript tools unless a human asks.

## Harness tools (kebab-case, fixed)

| Tool | When to use |
| --- | --- |
| `define-function` | Create or update a tool under `functions/…/`. |
| `load-function` | Recompile after edits (`call-function` auto-loads). |
| `find-function` | Discover tools (searches slug, `@moduledoc`, specs, description). |
| `call-function` | Run the entry module’s `run/1` with JSON `args`. |

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Registry slug | `snake_case` segments joined by `.` | `pipeline.demo`, `data.fetch.normalize` |
| On disk | `functions/<segment>/<segment>/…/` | `functions/pipeline/demo/tool.ex` |
| Entry module | `AgentFn.<Segments>` | `AgentFn.Pipeline.Demo` |
| Deep modules | same tree, no `run/1` | `AgentFn.Pipeline.Demo.Steps.Enrich` |
| Shared helpers | `AgentLib.*` in `functions/lib/` | `AgentLib.Strings` |
| Entry callback | `run/1` on the entry module only | `def run(args) when is_map(args)` |

- `args` uses **string keys** (JSON).
- Document with **`@moduledoc`** and **`@spec`** (synced to `meta.json` on load).
- **`@behaviour AgentFn.Tool`** on every entry module.

## Layout (flat or deep)

```
functions/pipeline/demo/
  tool.ex                 # AgentFn.Pipeline.Demo — only module with run/1
  steps/enrich.ex         # AgentFn.Pipeline.Demo.Steps.Enrich
  logic/transform.ex      # more nested modules as needed
functions/lib/            # AgentLib.* shared across slugs
```

Only **one** `run/1` entry point per slug (the entry module). Everything else is plain modules.

## Composition (higher-order)

Call other registry tools from Elixir:

```elixir
AgentFn.Registry.call("echo", args)
AgentFn.Registry.list()
```

Chain tools (each step must return a **map**):

```elixir
AgentFn.Compose.pipeline(%{"n" => 1}, ["echo", "other.slug"])
AgentFn.Compose.if_then("echo", fn a -> a["go"] end, args)
AgentFn.Compose.map_each(args, "items", "echo")
```

Prefer **deep modules** for logic and **Registry/Compose** for reuse across slugs. Build new slugs that orchestrate existing ones instead of duplicating code.

## Self-improvement loop

1. `find-function`
2. `define-function` (use dot slugs for namespaces)
3. `call-function` to verify
4. Split into `steps/` modules when `tool.ex` grows

## Safety

Elixir tools run on the host with full process power. Never embed secrets in source.
