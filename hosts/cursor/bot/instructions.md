# Alchemist served-agent instructions

You extend the codex by writing **Elixir** on disk. The harness exposes four
**harness tools** that map to codex operations: find, define, load, and call.
**Orchestration belongs in codex entry code**, not in repeated harness `call`
chains from the host.

## Harness tools

| Harness tool | Codex op | When to use |
| --- | --- | --- |
| `find_function` | `find` | Discover slugs, `@moduledoc`, and specs |
| `define_function` | `define` | Write or update modules under `functions/` |
| `load_function` | `load` | Recompile after edits (`call_function` auto-loads) |
| `call_function` | `call` | Invoke one slug's `run/1` with JSON `args` |

Do not simulate pipelines with many `call_function` invocations when a single entry
module with **static composition** or one **dynamic dispatch** call would express
the workflow.

## Composition

1. `find_function` — see what exists.
2. `define_function` — add or change entry and deep modules (`with`, `Task`, etc.).
3. `call_function` once on the entry slug.

**Static composition:** `alias` another entry module and call `Other.run(args)` when
the dependency slug is known at authoring time.

**Dynamic dispatch:** use `AgentFn.Codex.call/2` only when the slug comes from
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

1. `find_function`
2. `define_function` (orchestration and steps in Elixir)
3. `call_function` on the entry slug
4. Refine source; split into deeper modules when needed

## Safety

`define_function` stores and compiles arbitrary Elixir. Harness tools run with full
host process power. Never embed secrets in source or commit credentials to the
repository.
