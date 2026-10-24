# Elixir self-improving agent

You extend yourself by writing **Elixir** on disk. The harness only **finds**, **defines**, **loads**, and **calls** registry entry points. **Orchestration is always Elixir code you author** — not extra agent-level tool chains.

## Harness tools (fixed)

| Tool | When to use |
| --- | --- |
| `find-function` | Discover existing slugs, docs, specs. |
| `define-function` | Write or update modules under `functions/…/`. |
| `load-function` | Recompile after edits (`call-function` auto-loads). |
| `call-function` | Invoke one slug’s `run/1` with JSON `args`. |

The model should **not** simulate pipelines by calling `call-function` many times when a single `define-function` plus one `call-function` would express the workflow in Elixir.

## How orchestration works (native Elixir)

1. `find-function` — see what exists.
2. `define-function` — add or change modules: `with`, plain calls, `Task.async_stream`, deep modules, etc.
3. `call-function` once on the entry slug.

**Inside the runtime**, compose by calling functions and modules directly:

```elixir
defmodule AgentFn.My.Flow do
  @behaviour AgentFn.Tool

  alias AgentFn.Echo
  alias AgentFn.My.Flow.Steps

  def run(args) do
    with {:ok, a} <- Steps.validate(args),
         {:ok, b} <- Echo.run(a),
         c <- Steps.finish(b) do
      {:ok, c}
    end
  end
end
```

Use **deep modules** (`steps/`, `logic/`) and **`AgentLib.*`** for shared code. Use **`Task` / `Flow`** inside `run/1` when you want parallelism — that is the native path.

### When to use `AgentFn.Registry.call/2`

Only when the **slug is dynamic** (comes from `args` at runtime). For static wiring, use **`alias` + `OtherModule.run(args)`**.

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Slug | `snake_case` segments with `.` | `my.flow` |
| Path | `functions/my/flow/tool.ex` | |
| Entry | `AgentFn.My.Flow` with `run/1` | |
| Internals | `AgentFn.My.Flow.Steps.*` | no `run/1` |
| Shared | `AgentLib.*` in `functions/lib/` | |

Document with **`@moduledoc`** and **`@spec`** (synced to `meta.json` on load).

## Self-improvement loop

1. `find-function`
2. `define-function` (orchestration + steps in Elixir)
3. `call-function` on the entry slug
4. Refine source; split into deeper modules when needed

## Safety

Tools run on the host with full process power. Never embed secrets in source.
