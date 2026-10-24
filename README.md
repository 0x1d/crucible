# Elixir harness (Cursor Agent SDK)

A minimal agent whose **only task tools** are four harness endpoints. Real capabilities live in **Elixir functions** on disk under `functions/`. The model defines, discovers, loads, and calls those functions at runtime so the agent can grow new tools without redeploying TypeScript.

## Architecture

```
┌─────────────────────┐     JSON stdin/stdout      ┌──────────────────┐
│  Agent SDK (Node)   │ ─────────────────────────► │  runtime/ (Mix)  │
│  bot/tools/*.ts     │     define/load/find/call  │  Runtime.CLI     │
└─────────────────────┘                            └────────┬─────────┘
                                                            │
                                                            ▼
                                                   functions/<name>/
                                                     tool.ex, meta.json
```

| Harness tool | Elixir `op` | Purpose |
| --- | --- | --- |
| `define-function` | `define` | Write `tool.ex` + `meta.json` |
| `load-function` | `load` | `Code.compile_file/1` |
| `find-function` | `find` | Search registry |
| `call-function` | `call` | `AgentFn.<Name>.run(args)` |

Each function implements `run/1` with a map of string keys (JSON). Return `{:ok, map}`, `{:error, reason}`, or a plain map.

## Prerequisites

- Node 22.13+
- Elixir 1.14+ and Erlang/OTP (for the runtime)

```bash
# One-time Elixir setup on a fresh machine
mix local.hex --force
mix local.rebar --force
cd runtime && mix deps.get
```

## Run locally

```bash
npm install
npx @grok/agent-sdk dev
```

In another terminal:

```bash
npx @grok/agent-sdk tool call --dir . --tool find-function --input '{}'
npx @grok/agent-sdk tool call --dir . --tool call-function --input '{"name":"echo","args":{"hello":"world"}}'
```

Example bundled function: `functions/echo/`.

## Self-improvement workflow

1. `find-function` — avoid duplicate tools.
2. `define-function` — persist new Elixir `run/1` (or full module).
3. `call-function` — exercise the tool (auto-loads if needed).
4. Iterate on source until behavior is correct.

Instructions for the model live in `bot/instructions.md`.

## Security

Elixir tools run on the host with full process privileges. Treat `define-function` like arbitrary code execution. Do not run untrusted prompts on sensitive machines.

## License

MIT
