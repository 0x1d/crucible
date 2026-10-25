# Alchemist

A **host-agnostic Elixir tool registry** with an optional **Cursor Agent SDK**
adapter. The model gets four fixed tools; every real capability is an Elixir
module on disk (`functions/`) with `@moduledoc`, `@spec`, and `run/1`.

## Layers

```
┌──────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐
│  Host adapter    │   │  core/           │   │  runtime/ (Mix)         │
│  bot/ (Cursor)   │──►│  protocol +      │──►│  Runtime.CLI            │
│  or registry-cli │   │  elixir-bridge   │   │  AgentFn / AgentLib     │
└──────────────────┘   └──────────────────┘   └───────────┬─────────────┘
                                                            ▼
                                                  functions/<slug>/
```

| Layer | Path | Notes |
| --- | --- | --- |
| Registry | `runtime/`, `functions/` | Portable; no Cursor dependency |
| Bridge | `core/elixir-bridge.ts` | `define` / `load` / `find` / `call` |
| Cursor host | `bot/tools/*.ts` | `@grok/agent-sdk` — Slack, deploy, evals |
| Other hosts | `scripts/registry-cli.mjs` | See [docs/HOSTS.md](docs/HOSTS.md) |

## Naming

| | Convention |
| --- | --- |
| Harness tools | kebab-case (`define-function`) |
| Slug | `snake_case` with `.` namespaces → `functions/data/pipeline/` |
| Entry module | `AgentFn.Data.Pipeline` + `run/1` |
| Deep modules | `AgentFn.Data.Pipeline.Steps.*` (any depth under the slug tree) |
| Dynamic dispatch | `AgentFn.Registry.call/2` (static wiring: direct `run/1` calls) |
| Shared code | `AgentLib.*` under `functions/lib/` |
| Docs | `@moduledoc` / `@spec` → synced to `meta.json` on load |

## Prerequisites

- Node 22.13+ (for Cursor adapter only)
- Elixir 1.14+

```bash
mix local.hex --force && mix local.rebar --force
cd runtime && mix deps.get && mix test
```

### Nix / NixOS

Optional. Provides Node 22 and Elixir via a shared `shell.nix` (flake wraps the same shell).

1. Install [direnv](https://direnv.net/) (and preferably [nix-direnv](https://github.com/nix-community/nix-direnv) for caching).
2. Enable flakes if you want the primary path (`nix develop` / `use flake`); classic `nix-shell` still works without flakes.
3. From the repo root: `direnv allow`.
4. Run the mix/npm steps above if the shell prints `hint:` reminders.

Non-Nix users can ignore `flake.nix`, `shell.nix`, and `.envrc`.

**Full walkthrough:** [docs/USAGE.md](docs/USAGE.md) (Cursor chat, CLI tools, hand-edited Elixir).

## Cursor workflow

```bash
npm install
npx @grok/agent-sdk dev
```

```bash
npx @grok/agent-sdk tool call find-function --input '{}'
npx @grok/agent-sdk tool call call-function --input '{"name":"echo","args":{"hello":"world"}}'
```

## Host-agnostic CLI

```bash
node scripts/registry-cli.mjs '{"op":"find","query":""}'
node scripts/registry-cli.mjs '{"op":"call","name":"echo","args":{"x":1}}'
```

## Multi-subscription note

There is **no single vendor SDK** that bills Cursor, OpenCode Go, and Anthropic
together. Unify at this **registry protocol**; pick a **host** per environment
(Cursor BDK, OpenCode CLI, Claude Agent SDK) and wire the same four ops. Details:
[docs/HOSTS.md](docs/HOSTS.md).

## Security

`define-function` is arbitrary code execution on the host.

## License

MIT
