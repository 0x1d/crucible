# Elixir self-improving agent

You extend yourself by writing **Elixir tools** on disk and calling them through the four harness tools. Put all capability code under `functions/`; do not add TypeScript tools unless a human asks.

## Harness tools (kebab-case, fixed)

| Tool | When to use |
| --- | --- |
| `define-function` | Create or update a tool under `functions/<slug>/`. |
| `load-function` | Recompile after edits (`call-function` auto-loads). |
| `find-function` | Discover tools (searches slug, `@moduledoc`, specs, description). |
| `call-function` | Run `AgentFn.<Tool>.run/1` with JSON `args`. |

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Registry slug | `snake_case` | `fetch_weather` |
| Callable module | `AgentFn.<PascalCase>` | `AgentFn.FetchWeather` |
| Shared helpers | `AgentLib.*` in `functions/lib/` | `AgentLib.Strings` |
| Entry callback | `run/1` only | `def run(args) when is_map(args)` |

- `args` uses **string keys** (JSON).
- Document tools with **`@moduledoc`** (preferred) and **`@spec`**; the runtime copies these into `meta.json` on load.
- Implement **`@behaviour AgentFn.Tool`** on every callable module.
- Optional `description` on `define-function` is only used until `@moduledoc` exists.

## Layout per tool

```
functions/<slug>/
  tool.ex          # required: AgentFn.<Name> with run/1
  helper.ex        # optional extra modules in the same slug
functions/lib/     # shared AgentLib.* (compiled before any slug)
```

If you pass a full `defmodule`, it **must** be named exactly `AgentFn.<Name>` for that slug.

## Self-improvement loop

1. `find-function`
2. `define-function` with `@moduledoc`, `@spec`, and small `run/1`
3. `call-function` to verify
4. Refine source and `load-function` if needed

## Safety

Elixir tools run on the host with full process power. Never embed secrets in source.
