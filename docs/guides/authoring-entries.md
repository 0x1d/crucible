# Authoring codex entries

Codex entries are Elixir modules under `functions/`, each exposing `run/1` on
an `AgentFn.*` entry module. Hosts interact only through the four codex
operations; multi-step behavior belongs in Elixir on disk.

## Slug, path, and module

| Slug segment | Path segment | Module segment |
| --- | --- | --- |
| `snake_case` | directory name | `CamelCase` |

Example slug `pipeline.demo`:

- Directory: `functions/pipeline/demo/`
- Entry module: `AgentFn.Pipeline.Demo`
- Primary source file: `functions/pipeline/demo/tool.ex`

## Entry module example

```elixir
defmodule AgentFn.Greet do
  @moduledoc """
  Adds a greeting field to the args map.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()}
  def run(args) when is_map(args) do
    name = Map.get(args, "name", "")
    {:ok, Map.put(args, "greeting", "hello " <> name)}
  end
end
```

Use `@moduledoc` and `@spec`; after `load` or `define`, their text is copied into
`meta.json` for `find`.

## Deep modules

Place supporting modules under the entry tree (for example `steps/`). They are
compiled with the entry but are not separately addressable slugs.

The bundled `pipeline.demo` entry calls `AgentFn.Pipeline.Demo.Steps.Enrich` and
composes with `AgentFn.Echo.run/1` via static module calls.

## Shared libraries

Code reused across entries lives under `functions/lib/` as `AgentLib.*` modules.
The compiler loads all `functions/lib/**/*.ex` before compiling a slug tree.

## Static composition and dynamic dispatch

Prefer **static composition** when the callee slug is known while authoring:

```elixir
alias AgentFn.Echo

Echo.run(args)
```

Use **`AgentFn.Codex.call/2`** only when the slug is runtime data from `args`.

## Harness operations

| Operation | Typical use |
| --- | --- |
| `define` | Create or replace `tool.ex` from generated or pasted source |
| Hand edit | Add deep modules or refine logic directly in `functions/` |
| `load` | Compile after hand edits (`call` also auto-loads) |
| `find` | Discover slugs and metadata (`meta.json` must exist) |
| `call` | Run `run/1` with a JSON object |

### `define` source forms

- **Bare body:** wrapped in `defmodule AgentFn.<Slug>` with `@behaviour AgentFn.Tool`.
- **Full module:** must declare `defmodule AgentFn.<Slug>` matching the slug.

### Metadata lifecycle

`find` lists directories that contain `meta.json`. A new hand-authored directory
without metadata appears only after `define`, `load`, or a successful `call` that
refreshes metadata.

The `"loaded"` flag in `meta.json` records the last successful validation on
disk. The long-lived BEAM may still hold compiled modules in memory until it
restarts.

## Result shapes

`Runtime.Engine` normalizes `run/1` results for JSON hosts:

- `{:ok, map}` or `{:ok, term}` → success with `result`
- `{:error, reason}` → failure with `error` string
- bare map → success with that map as `result`

## Testing an entry

```bash
node scripts/cli.mjs '{"op":"load","name":"my.entry"}'
node scripts/cli.mjs '{"op":"call","name":"my.entry","args":{}}'
```

Add ExUnit tests under `runtime/test/` when exercising codex-runtime behavior, or
test modules directly with `mix test` in `runtime/` when logic is pure Elixir.

## Security

`define` and `call` execute arbitrary Elixir with host privileges. Review source
before loading in sensitive environments. See [Security boundary](../reference/security.md).

## Related reading

- [Memory](../concepts/memory.md)
- [Domain language](../concepts/domain-language.md)
- [Architecture](../concepts/architecture.md)
- [Codex protocol](../reference/protocol.md)
- [Alchemist served-agent instructions](../../hosts/cursor/bot/instructions.md)
