# Using the harness

Alchemist has **four fixed tools** (the harness). Everything else is **Elixir on disk**
under `functions/`. The agent discovers, writes, and runs code there; orchestration
lives in Elixir, not in repeated tool calls.

## Mental model

```
You / agent  →  host (Cursor BDK or registry-cli)  →  four ops  →  BEAM (Runtime.Server)  →  functions/
```

| Harness tool | Registry `op` | What it does |
| --- | --- | --- |
| `find-function` | `find` | Search slugs, `@moduledoc`, specs |
| `define-function` | `define` | Write `functions/<slug>/tool.ex` (+ siblings) |
| `load-function` | `load` | Compile slug tree |
| `call-function` | `call` | `AgentFn.*.run(args)` |

Model-facing rules for the agent: [`bot/instructions.md`](../../bot/instructions.md).

## One-time setup

```bash
mix local.hex --force && mix local.rebar --force
cd runtime && mix deps.get
cd .. && npm install   # only for Cursor host
```

## Path A — Cursor Agent SDK (playground, deploy, Slack, …)

**Model:** `bot/agent.ts` defaults to Cursor **Auto** (`model: "auto"`). Change it to a
fixed id (e.g. `grok-4.5`, `composer-2.5`) or Router (`auto-smart` + `optimize_for`) if needed.

**1. Start the dev server**

```bash
npx @grok/agent-sdk dev
```

Sign in if prompted (`npx @grok/agent-sdk login`). Open the playground URL from the terminal.

**2. Talk to the agent** (natural language), or call tools directly:

```bash
# List registry
npx @grok/agent-sdk tool call find-function --input '{}'

# Run bundled echo tool
npx @grok/agent-sdk tool call call-function \
  --input '{"name":"echo","args":{"hello":"world"}}'

# Define a new tool (agent normally does this via define-function)
npx @grok/agent-sdk tool call define-function --input '{
  "name": "greet",
  "source": "@spec run(map()) :: {:ok, map()}\ndef run(args) do\n  {:ok, Map.put(args, \"greeting\", \"hi \" <> (args[\"name\"] || \"\"))}\nend"
}'
```

**3. Typical agent loop** (what you ask in chat)

1. “What Elixir tools exist?” → `find-function`
2. “Add a tool that …” → `define-function` (writes Elixir under `functions/greet/`)
3. “Run it with …” → `call-function` once on slug `greet`

The agent should **not** chain many `call-function` calls to fake a pipeline; it should
put the pipeline in Elixir and call once.

**4. Inspect disk**

After `define-function`, look at:

```
functions/<slug>/tool.ex
functions/<slug>/meta.json   # description/moduledoc/specs after load
```

Nested slugs use dots: `pipeline.demo` → `functions/pipeline/demo/`.

## Path B — Host-agnostic (no Cursor)

Same registry. Each command talks to one long-lived BEAM (started on first use):

```bash
node scripts/registry-cli.mjs '{"op":"find","query":""}'
node scripts/registry-cli.mjs '{"op":"call","name":"echo","args":{"x":1}}'
node scripts/registry-cli.mjs '{"op":"define","name":"my.tool","source":"..."}'
```

Wire these four commands as custom tools in OpenCode, Claude Code, or any host.
See [Host adapters](../reference/hosts.md).

## Path C — You edit Elixir by hand

1. Add or edit files under `functions/my_tool/` (`tool.ex` + optional `steps/*.ex`).
2. Load:

```bash
node scripts/registry-cli.mjs '{"op":"load","name":"my_tool"}'
```

3. Call:

```bash
node scripts/registry-cli.mjs '{"op":"call","name":"my_tool","args":{}}'
```

## Example: composed flow on disk

Bundled example slug `pipeline.demo`:

- `functions/pipeline/demo/steps/enrich.ex` — deep module
- `functions/pipeline/demo/tool.ex` — `run/1` calls `Enrich` then `AgentFn.Echo.run/1`

```bash
node scripts/registry-cli.mjs '{"op":"call","name":"pipeline.demo","args":{"input":"go"}}'
```

## Validate project

```bash
npx @grok/agent-sdk validate --dir .
cd runtime && mix test
npm run check
```

## Where to read more

| Doc | Audience |
| --- | --- |
| [README.md](../../README.md) | Product overview and quick start |
| [bot/instructions.md](../../bot/instructions.md) | System prompt for the agent |
| [Host adapters](../reference/hosts.md) | Cursor vs OpenCode vs Anthropic |
| [core/protocol.ts](../../core/protocol.ts) | JSON op types |
