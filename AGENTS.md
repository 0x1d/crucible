# Alchemist

This file contains repository-agent rules for coding agents editing Alchemist.
The [product overview](README.md) and [documentation index](docs/index.md)
describe the product and its public reading paths. The served agent's prompt is
`bot/instructions.md`.

## Loop

```bash
agent-sdk validate --dir .
agent-sdk info --dir . --json
agent-sdk run --dir . --message "..."
agent-sdk eval --dir .
npm run check
```

Run the CLI under Node, never Bun.

## Git commits

Use [Conventional Commits](https://www.conventionalcommits.org/): lowercase type,
optional scope in parentheses, imperative subject, no trailing period.

Examples: `feat(bot): add search tool`, `fix(nix): correct flake inputs`,
`docs: update README prerequisites`.

## Layout

- `bot/instructions.md` is the always-on prompt. Keep it short.
- `bot/tools/<name>.ts` is one tool per file. The filename is the tool name.
- `bot/lib/` is shared code. Never discovered.
- `evals/` is filesystem evals (`evals/evals.config.ts` required).
  Not `bot/evals/`. That path is ignored.

## Documentation

Public documentation describes components, contracts, paths, and behavior.
Write one sentence per line, breaking only after the sentence's closing punctuation.
Keep the prose descriptive.
State what exists and what it does.
Omit conversational narrative, including asides about what a build tool is for.
Name the long-lived process, its supervision tree, and its state files.

## Do not

- Grow host TypeScript for formatting, classification, or reply composition.
  That stays in instructions/skills. Host code owns auth, idempotency,
  evidence seeding, and side-effect gates.
- Add npm deps on a first cut. Stick to what `@grok/agent-sdk` already ships.
- Point `serve` at a parent folder during bring-up. It mounts every sibling.

## Full codebase review (Elixir)

Agents doing a broad review of the BEAM runtime or Elixir tools should start with
[REVIEW.md](REVIEW.md). It catalogs official Elixir anti-patterns with links to
examples and refactoring guidance on [hexdocs](https://elixir.hexdocs.pm/what-anti-patterns.html).

## Pointers

- Package loop: `node_modules/@grok/agent-sdk/AGENTS.md`
- Skills: `node_modules/@grok/agent-sdk/skills/` (`create-agent`, `deploy`, `evals`, `hillclimb`, `debug`)
- Docs: `npx @grok/agent-sdk docs`
- LLM docs index: `node_modules/@grok/agent-sdk/dist/docs/llms.txt`

## Cursor Cloud specific instructions

- Node 22, Elixir 1.20.4, and OTP 28 are on `PATH` (`elixir`, `mix`, and `erl` in `/usr/local/bin`). When `node_modules` or `runtime/deps` is missing, run `npm ci` at the repo root and `mix deps.get` in `runtime/`.
- Unattended product check: `node scripts/cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'` returns `"ok":true` with `"echoed":true`. The command reaches the long-lived BEAM (`elixir --no-halt`), which supervises a permanent acceptor and one temporary task per call. Also run `npm run check`, `npx @grok/agent-sdk validate --dir .`, and `cd runtime && mix test`.
- `npx @grok/agent-sdk dev` needs an interactive Cursor login, so the environment does not start it on boot.
