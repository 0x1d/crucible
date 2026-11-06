# Alchemist

This file contains repository-agent rules for coding agents editing Alchemist.
The [product overview](README.md) and [documentation index](docs/index.md)
describe the product and its public reading paths. The served agent's prompt is
`hosts/cursor/bot/instructions.md`.

## Loop

```bash
agent-sdk validate --dir hosts/cursor
agent-sdk info --dir hosts/cursor --json
agent-sdk run --dir hosts/cursor --message "..."
agent-sdk eval --dir hosts/cursor
npm run check
```

Session-trace memory (fixture graph, plain Node; Elixir must already be on `PATH`):

```bash
npm run seed:session-trace
npm run dev:session-trace
npm run eval:session-trace
```

Terminal UI (`tui/`, Claude host):

```bash
npm run tui
npm run test:tui
```

Run the CLI under Node, never Bun.

## Git commits

Use [Conventional Commits](https://www.conventionalcommits.org/): lowercase type,
optional scope in parentheses, imperative subject, no trailing period.

Examples: `feat(bot): add search tool`, `fix(nix): correct flake inputs`,
`docs: update README prerequisites`.

Commit messages and bodies are plain text only.
Do not put HTML in commits: no tags, entities, or markup copied from PR tools,
dashboards, or chat.
Write the same prose you would in a terminal `git commit`.

## Pull requests

When you author a PR title or description, use plain Markdown only.
Do not paste HTML from the Cursor UI: no `<div>` footers, `<picture>`/`<img>`
“Open in Web” or “Open in Cursor” buttons, or other rendered agent CTAs.
The `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->` … `<!-- CURSOR_AGENT_PR_BODY_END -->`
wrappers and metadata appended by PR tooling are fine; leave that to the tool.
Do not hand-author that HTML or copy a full rendered PR comment into a commit.

## Layout

- `hosts/cursor/` is the Cursor Agent SDK host. Every `agent-sdk` command takes `--dir hosts/cursor`.
- `hosts/cursor/bot/instructions.md` is the always-on prompt. Keep it short.
- `hosts/cursor/bot/tools/<name>.ts` is one tool per file. The filename is the tool name.
- `hosts/cursor/bot/lib/` is shared code. Never discovered.
- `hosts/cursor/evals/` is filesystem evals (`evals.config.ts` required).
  Not `bot/evals/`. That path is ignored.
- `hosts/claude/` is the Claude Agent SDK example host. `npm run eval:claude` runs its evals.
- `hosts/acp/` is the ACP client host. External agents run as subprocesses. `npm run eval:acp` runs its eval.
- `hosts/shared/` is codex tool code shared by the Claude and ACP hosts.
- `tui/` is the terminal UI. It imports the hosts. No file under `hosts/` or `core/` imports it.

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
- Add npm deps on a first cut. Stick to what `@grok/agent-sdk` and
  `@anthropic-ai/claude-agent-sdk` already ship.
  `@earendil-works/pi-tui` is an exception. Only `tui/` imports it.
  `@agentclientprotocol/sdk` (pinned) and `@modelcontextprotocol/server` are exceptions for the ACP host.
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
- Unattended product check: `node scripts/cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'` returns `"ok":true` with `"echoed":true`. The command reaches the long-lived BEAM (`elixir --no-halt`), which supervises a permanent acceptor and one temporary task per call. Also run `npm run check`, `npx @grok/agent-sdk validate --dir hosts/cursor`, and `cd runtime && mix test`.
- `npm run dev` needs an interactive Cursor login, so the environment does not start it on boot.
