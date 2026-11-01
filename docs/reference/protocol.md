# Codex protocol

Hosts interact with Alchemist through four JSON operations: `define`, `load`,
`find`, and `call`. TypeScript definitions live in [`core/protocol.ts`](../../core/protocol.ts).
The Cursor and Claude adapters expose snake_case codex tool names that map one-to-one to these operations.

| Operation | Codex tool | Purpose |
| --- | --- | --- |
| `define` | `define_function` | Write or replace entry source on disk and compile |
| `load` | `load_function` | Compile an existing entry tree from disk |
| `find` | `find_function` | Search discovered entries by metadata |
| `call` | `call_function` | Invoke an entry's `run/1` with a JSON object |

Every request is a JSON object with an `op` field. The live interface is one
length-prefixed JSON request and one length-prefixed JSON response on a TCP
connection to the long-lived BEAM.

## Slug mapping

Slugs are dot-separated segments; each segment uses `snake_case`. The codex
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
| `query` | string | yes | Case-insensitive substring filter (empty rejected) |
| `limit` | integer | no | Max hits 1–40 (default 12) |
| `detail` | boolean | no | When true, return full metadata per hit (default false) |

**Success (default, slim)**

```json
{
  "ok": true,
  "functions": [ { "name": "echo", "summary": "Example codex entry...", "loaded": true } ],
  "count": 1,
  "truncated": false,
  "detail": false,
  "limit": 12
}
```

With `detail: true`, each element matches the full `meta.json` shape (moduledoc, specs, module, …).

**Discovery rule**

`find` walks `functions/` and filters metadata in memory.
Matching searches slug, description, moduledoc, specs text, and module name.
Slim mode keeps tool results small for the model context.

**Failure**

Empty `query` returns `ok: false`.
Zero matches returns `count: 0` (not an error).

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

`Runtime.CodexWarmup` compiles every entry under `AGENT_FUNCTIONS_DIR` when the
`:runtime` application starts.
After that, `call` invokes `run/1` on the live module.
If a slug was added on disk without a VM restart, or warm load skipped a broken
entry, `call` compiles that slug through `load` before `apply(module, :run, [args])`.

## Node bridge behavior

`core/elixir-bridge.ts` compiles `runtime/` when runtime sources change.
Codex operations run in `elixir --no-halt` with `Application.ensure_all_started(:runtime, :permanent)`.
The bridge sets `AGENT_FUNCTIONS_DIR` to the repository `functions/` directory unless the environment already overrides it.
The bridge sets `ALCHEMIST_STATE_DIR` to `runtime/.alchemist` unless that variable is already set.
Unless `NODE_ENV=production` or `ALCHEMIST_RUNTIME_DETACHED=1`, the bridge stops the BEAM when the Node host exits (local dev and evals).

The live interface is TCP on `127.0.0.1`.
Each request is one JSON object framed with a 4-byte big-endian length, matching `:gen_tcp` `packet: 4`.
The response uses the same framing.
`port` and `pid` in the state directory identify the running VM.
The bridge writes `stamp` there after a successful boot.

A transport failure replaces the recorded VM and retries the operation once.
Non-JSON responses surface as `{ "ok": false, "error": "..." }` to the host adapter.
`Runtime.CLI.run_stdio/0` reads one JSON request from stdin.
It is a debug helper.

## Failure behavior

- The acceptor owns the listen socket. Accept errors exit that task. The
  application supervisor allows 3 restarts in 5 seconds, then stops. Because the
  application is permanent, the VM exits and the bridge boots a new one.
- Each connection is a temporary task that owns its socket. `run/1` runs there.
  `exit/1` from `run/1` becomes `{ "ok": false, "error": "..." }` on that
  connection. A linked process that dies takes down that task only.
- `define` and `load` run on `Runtime.Server` so compilation stays
  single-threaded. That process does not own the listen socket, so a compile
  does not block accept.

## Limitations (current)

- One JSON request per connection; no batching or streaming.
- No built-in sandbox: `define` and `call` execute with host process privileges.
- `loaded` in `meta.json` is bookkeeping, not a live compile cache across requests.
- Dynamic `AgentFn.Codex.call/2` re-enters the same engine and may trigger
  nested loads in the same VM.

## Related reading

- [Security boundary](./security.md)
- [Architecture](../concepts/architecture.md)
- [Domain language](../concepts/domain-language.md)
