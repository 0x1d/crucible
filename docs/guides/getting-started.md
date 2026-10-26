# Getting started

This guide installs dependencies, validates the repository, and invokes the bundled
`echo` codex entry through the host-agnostic CLI. Optional sections cover the
Cursor Agent SDK adapter and the Nix/direnv shell.

## Prerequisites

- Elixir 1.14+ with `mix` on `PATH`
- Node 22.13+ (required only for the Cursor adapter and TypeScript checks)

## Install dependencies

```bash
npm ci
mix local.hex --force
mix local.rebar --force
(cd runtime && mix deps.get)
```

## Validate

```bash
npm run check
npx @grok/agent-sdk validate --dir .
(cd runtime && mix test)
```

## First codex call

The host-agnostic CLI forwards JSON operations to the codex runtime (via the Node bridge):

```bash
node scripts/cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'
```

Expected: `"ok": true` with `"echoed": true` in the result map.

List discovered entries:

```bash
node scripts/cli.mjs '{"op":"find","query":""}'
```

## Optional: Cursor Agent SDK

For playground, deploy, evals, and channels:

```bash
npx @grok/agent-sdk dev
```

Sign in when prompted (`npx @grok/agent-sdk login`). The adapter exposes four
harness tools (`define-function`, `load-function`, `find-function`,
`call-function`) that map to the codex operations.

Example direct tool invocation:

```bash
npx @grok/agent-sdk tool call call-function \
  --input '{"name":"echo","args":{"hello":"world"}}'
```

Served-agent behavior is defined in [`bot/instructions.md`](../../bot/instructions.md).

## Optional: Claude Agent SDK host

The Claude host runs the same four tools through the Claude Code harness.
It needs Claude Code credentials or `ANTHROPIC_API_KEY`.

```bash
npm run chat:claude
```

Run the Claude evals:

```bash
npm run eval:claude
```

Host files and options are described in the [Claude host README](../../hosts/claude/README.md).

## Optional: Nix and direnv

The repository provides `flake.nix`, `shell.nix`, and `.envrc` for reproducible
Node and Elixir versions on NixOS and other Nix installations. Enable direnv in
the repository root (`direnv allow`) and follow any `hint:` lines from the shell
hook for remaining `mix` or `npm` steps.

Design notes for this workflow live in the
[internal records index](../internal/index.md) (Nix/direnv plan and spec).

## Next steps

- [Authoring codex entries](./authoring-entries.md)
- [Codex protocol](../reference/protocol.md)
- [Host adapters](../reference/hosts.md)
- [Security boundary](../reference/security.md)
