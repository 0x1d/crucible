# Registry protocol

Hosts interact with Alchemist through four JSON operations: `define`, `load`,
`find`, and `call`. TypeScript definitions live in [`core/protocol.ts`](../../core/protocol.ts).
The Cursor adapter exposes kebab-case harness tool names that map one-to-one to
these operations.

| Operation | Harness tool (Cursor) | Purpose |
| --- | --- | --- |
| `define` | `define-function` | Write or replace entry source on disk and compile |
| `load` | `load-function` | Compile an existing entry tree from disk |
| `find` | `find-function` | Search discovered entries by metadata |
| `call` | `call-function` | Invoke an entry's `run/1` with a JSON object |

Every request is a JSON object with an `op` field. The Mix control plane reads one
request from stdin and prints one JSON response on stdout.

## Slug mapping

Slugs are dot-separated segments; each segment uses `snake_case`. The registry
maps a slug to a directory path and an entry module name.

| Slug | Directory | Entry module |
| --- | --- | --- |
| `echo` | `functions/echo/` | `AgentFn.Echo` |
| `pipeline.demo` | `functions/pipeline/demo/` | `AgentFn.Pipeline.Demo` |

Sanitization lowercases input, splits on `.`, and normalizes each segment to
`[a-z0-9_]+`. An empty slug after sanitization is rejected.

`define` writes `functions/<slug>/tool.ex` (unless the source is a full
`defmodule`). `meta.json` in the same directory holds discovery metadata.

## `define`

**Request**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"define"` | yes | Operation discriminator |
| `name` | string | yes | Slug for the new or updated entry |
| `source` | string | yes | Elixir body or full `defmodule` |
| `description` | string | no | Stored in metadata when `@moduledoc` is absent |

**Success** (`ok: true`)

```json
{
  "ok": true,
  "function": { "name": "echo", "module": "Elixir.AgentFn.Echo", "loaded": true, ... }
}
```

**Failure** (`ok: false`)

- Missing or empty `name` / `source`
- `ArgumentError` from module name mismatch when source includes `defmodule`
- Compile or validation errors (wrong entry module, missing `run/1`)

**Disk**

- Creates `functions/<slug>/` if needed
- Writes `tool.ex` (wraps bare source in `defmodule AgentFn.*` when needed)
- Updates `meta.json` (`loaded` set true after successful compile)

**Compile**

Compiles `functions/lib/**/*.ex` shared code, then all `.ex` files under the slug
tree. The entry module must be `AgentFn.<SlugParts>` and export `run/1`.

## `load`

**Request**

| Field | Type | Required |
| --- | --- | --- |
| `op` | `"load"` | yes |
| `name` | string | yes |

**Success**

```json
{
  "ok": true,
  "function": { ... },
  "module": "Elixir.AgentFn.Echo"
}
```

**Failure**

- Missing `name`
- Unknown slug directory or no `.ex` sources
- Entry module validation errors

**Disk**

- Reads sources; refreshes `meta.json` from `@moduledoc` and `@spec`
- Sets `"loaded": true` in `meta.json`

**Compile**

Same as `define` for an existing tree. Compilation happens in the long-lived BEAM
serving the request.

## `find`

**Request**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"find"` | yes | |
| `query` | string | no | Case-insensitive substring filter (default `""`) |

**Success**

```json
{
  "ok": true,
  "functions": [ { "name": "echo", "description": "...", "moduledoc": "...", ... } ],
  "count": 1
}
```

**Discovery rule**

`find` walks `functions/` and returns one record per directory that contains
`meta.json`. A hand-edited tree without `meta.json` does not appear until
`define`, `load`, or a successful `call` (which may auto-load and refresh metadata)
has created or updated metadata.

Matching searches slug, description, moduledoc, specs text, and module name.

**Failure**

Malformed requests are rejected by the CLI; `find` itself does not fail on empty
results (count may be zero).

## `call`

**Request**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `"call"` | yes | |
| `name` | string | yes | Target slug |
| `args` | object | no | JSON object passed to `run/1` (default `{}`) |

**Success**

`run/1` return shapes are normalized as follows:

| `run/1` return | Response |
| --- | --- |
| `{:ok, value}` | `{ "ok": true, "result": value, "function": "<slug>" }` |
| `{:error, message}` | `{ "ok": false, "error": "<message>", "function": "<slug>" }` |
| map | `{ "ok": true, "result": <map>, ... }` |
| other | `{ "ok": true, "result": <term>, ... }` |

**Failure**

- Missing `name` or non-object `args`
- Unknown slug, missing `run/1`, or runtime exceptions

**Auto-load**

If the entry module is not loaded in the current process, `call` invokes `load`
before `apply(module, :run, [args])`.

## Node bridge behavior

`core/elixir-bridge.ts` runs `mix compile` in `runtime/`, then `mix run --no-start`
with `Runtime.CLI.run_stdio()`, passing the request JSON on stdin. It sets
`AGENT_FUNCTIONS_DIR` to the repository `functions/` directory unless the
environment already overrides it.

Non-zero Mix exit codes and non-JSON stdout surface as `{ "ok": false, "error": "..." }`
to the host adapter.

## Limitations (current)

- One request per Mix process; no batching or streaming.
- No built-in sandbox: `define` and `call` execute with host process privileges.
- `loaded` in `meta.json` is bookkeeping, not a live compile cache across requests.
- Dynamic `AgentFn.Registry.call/2` re-enters the same engine and may trigger
  nested loads in the same process.

## Related reading

- [Security boundary](./security.md)
- [Architecture](../concepts/architecture.md)
- [Domain language](../concepts/domain-language.md)
