# Host adapters (Cursor, OpenCode, Anthropic, …)

Alchemist splits **portable registry** from **agent host**:

| Layer | Location | Responsibility |
| --- | --- | --- |
| Registry | `runtime/` + `functions/` | Define, load, find, call Elixir tools |
| Bridge | `core/elixir-bridge.ts` | JSON ops → one long-lived BEAM |
| Host adapter | `bot/` (Cursor today) | Map model tool calls → registry ops |

The model only needs four tools (`define-function`, `load-function`,
`find-function`, `call-function`). Any environment that can run `mix` and
invoke JSON can use the same registry without `@grok/agent-sdk`.

## Cursor (this repo)

- **Package:** `@grok/agent-sdk` — channels, deploy, evals, playground.
- **Adapter:** `bot/tools/*.ts` → `runRegistryOp()` from `core/`.
- **Credential:** `CURSOR_API_KEY` / `agent-sdk login`.

## OpenCode

- **Inference:** [OpenCode Go](https://opencode.ai/v2/docs/console/go/) routes
  Anthropic/OpenAI-compatible traffic through your OpenCode subscription.
- **Agent loop:** OpenCode CLI + [ACP](https://github.com/ethpandaops/opencode-agent-sdk-go)
  or `opencode run` with JSON tools.
- **Integration:** Register four MCP or shell tools that call
  `node scripts/registry-cli.mjs '<json>'`. Point the agent at the same
  `functions/` tree (set `AGENT_FUNCTIONS_DIR` if not default).

There is no single official “OpenCode + Cursor + Anthropic” npm package; OpenCode
is its own stack. Share **registry + instructions**, swap the host.

## Anthropic (direct)

- **API / Agent SDK:** [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents)
  or Messages API with tool definitions.
- **Integration:** Same four tools calling `registry-cli.mjs` or a small HTTP
  shim around `Runtime.CLI`.
- **Billing:** Anthropic API key / subscription, not Cursor.

## Go multi-agent wrappers (experimental community)

If you want one **Go** interface over several CLIs (Claude Code, OpenCode,
Cursor agent, Codex):

- [go-agent-agnostic](https://github.com/j3ssie/go-agent-agnostic)
- [agent-wrapper](https://github.com/smallnest/agent-wrapper)

These drive **existing agent CLIs**, not Alchemist’s Elixir registry directly.
Typical pattern: wrapper runs the outer agent; outer agent’s custom tools call
`registry-cli.mjs` for your Elixir surface.

## Recommended layout for you

1. Keep **all capability code** in `functions/` (Agent SDK optional).
2. Use **Cursor BDK** when you want Slack/GitHub/deploy/evals.
3. Use **registry-cli + OpenCode** (or Claude Code) when you want another
   subscription or local loop — same tools on disk, different host.
4. Do **not** expect one vendor SDK to bill across Cursor, OpenCode, and
   Anthropic; unify at the **registry protocol** (`core/protocol.ts`), not at
   the LLM invoice layer.
