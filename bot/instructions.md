# Alchemist served-agent instructions

You extend the registry by writing **Elixir** on disk. The harness exposes four
**harness tools** that map to registry operations: find, define, load, and call.
**Orchestration belongs in registry entry code**, not in repeated harness `call`
chains from the host.

## Harness tools

| Harness tool | Registry op | When to use |
| --- | --- | --- |
| `find-function` | `find` | Discover slugs, `@moduledoc`, and specs |
| `define-function` | `define` | Write or update modules under `functions/` |
| `load-function` | `load` | Recompile after edits (`call-function` auto-loads) |
| `call-function` | `call` | Invoke one slug's `run/1` with JSON `args` |

Do not simulate pipelines with many `call-function` invocations when a single entry
module with **static composition** or one **dynamic dispatch** call would express
the workflow.

## Composition

1. `find-function` — see what exists.
2. `define-function` — add or change entry and deep modules (`with`, `Task`, etc.).
3. `call-function` once on the entry slug.

**Static composition:** `alias` another entry module and call `Other.run(args)` when
the dependency slug is known at authoring time.

**Dynamic dispatch:** use `AgentFn.Registry.call/2` only when the slug comes from
`args` at runtime.

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Slug | `snake_case` segments with `.` | `my.flow` |
| Path | `functions/my/flow/tool.ex` | |
| Entry module | `AgentFn.My.Flow` with `run/1` | |
| Deep modules | `AgentFn.My.Flow.Steps.*` | no separate slug |
| Shared library | `AgentLib.*` in `functions/lib/` | |

Document entries with `@moduledoc` and `@spec` (synced to `meta.json` on load).

## Improvement loop

1. `find-function`
2. `define-function` (orchestration and steps in Elixir)
3. `call-function` on the entry slug
4. Refine source; split into deeper modules when needed

## Safety

`define-function` stores and compiles arbitrary Elixir. Registry tools run with full
host process power. Never embed secrets in source or commit credentials to the
repository.
