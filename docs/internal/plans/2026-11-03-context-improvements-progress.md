# Context window improvements — implementation progress (2026-11-03)

Tracks work from [cursor host context](2026-11-03-cursor-host-context.md),
[context handoff](../specs/2026-11-03-context-handoff-design.md),
[prompt cache](../specs/2026-11-03-prompt-cache-design.md), and related plans.

Toggle improvements with `/ctx` in the TUI or edit
`hosts/cursor/.agent-serve/context-improvements.json`.
Host-side flags apply on the next `serve()` start (restart the TUI or `/host`).

## Improvement matrix

| Id | Source item | Default | Effect on context window |
| --- | --- | --- | --- |
| `resultDigest` | §1 bridge cap / digest | on | Shrinks large `call_function` results in the transcript; baseline named-read ~25.7k vs uncapped read ~119k. |
| `defaultMaxBytes` | §6 default caps | off | Injects `max_bytes` on `fs.read` / `http.get`; lowers per-turn blobs; may hide tail unless user reads `path`. |
| `pinnedModel` | prompt-cache design | off | Pins server default to `composer-2.5` at `reasoning_effort=high` (no `fast`); follow-up cache read should approach full prompt (eval gate). |
| `handoffTool` | handoff design | off | Exposes `handoff` server tool (~schema tokens); model can write `handoff.md`. |
| `handoffFork` | handoff design | off | TUI forks to a new session after handoff when over 200k or user compacted; drops old transcript from live prompt. |
| `toolResultLog` | §7 observability | off | Logs largest tool results per turn to `.agent-serve/context-tool-sizes.log`. |

Already shipped without a flag (measured in the host-context plan):

- Named-path one-shot `fs.read` rule in `instructions.md`.
- Shorter always-on prompt (`bot/skills/*`).
- `docker.ps_report` summary, array/string digests in `call_function`.
- Footer cached/read/write/new split (`tui/view.ts`).

## Verification log

Branch `feat/tui` at `93e2162` (2026-11-03, Europe/Zurich).
BEAM evals and `node scripts/cli.mjs` need `nix develop` (Elixir on `PATH`).
Plain shell without nix still passes token-budget gates but fails tool-output checks with `spawn elixir ENOENT`.

| Check | Status | Notes |
| --- | --- | --- |
| `git pull origin feat/tui` | pass | fast-forward `93232e1..93e2162` |
| `npm run check` | pass | types + docs |
| `npm run test:tui` | pass | 79 tests |
| `node --test` (context + handoff libs) | pass | 13 tests (handoff, context-improvements, prompt-stability, `/ctx`) |
| `npm run test:hosts` | partial | 16/17; cursor `instructions.md` has no `### Examples` (shorter prompt); claude examples pass in nix |
| `nix develop -- node scripts/cli.mjs … echo` | pass | `ok:true`, `echoed:true` |
| `npx @grok/agent-sdk validate --dir hosts/cursor` | pass | |
| `npm run eval:cursor -- smoke` | pass | 9.8s; artifacts `…/evals/2026-11-03T15-00-28-442Z` |
| `nix develop -- npm run eval:cursor -- context-size` | pass | 4/4; artifacts `…/evals/2026-11-03T15-01-42-338Z` |
| `nix develop -- ALCHEMIST_CTX_handoffTool=1 npm run eval:cursor -- handoff/compact` | pass | 17.1s; `inputTokens=21636`; artifacts `…/evals/2026-11-03T15-02-34-273Z` |
| `nix develop -- ALCHEMIST_CTX_pinnedModel=1 npm run eval:cursor -- prompt-cache/pong` | pass | 7.7s; `prompt1=6819`, `prompt2=6915`, `cache2=6784`; artifacts `…/evals/2026-11-03T15-02-52-392Z` |
| `npm run eval:cursor -- context-size` (no nix) | fail | 0/4; budgets ok but reply gates fail on Elixir errors |

## Measurements

Baseline from [cursor host context](2026-11-03-cursor-host-context.md) (2026-11-03, gate evals):

| Improvement | Input tokens (named read gate) | Effect |
| --- | --- | --- |
| Search-before-read (reverted path) | 62,802 fail | Extra tools inflate prompt |
| One-shot named `fs.read` | 29,426 pass (earlier) | −33k vs search path |
| Shorter instructions / skills | 25,743 pass (earlier) | −3k |
| `call_function` digest (32k cap + array/string digest) | large read 21,548; docker list 14,447 (2026-11-03 nix run) | Stops multi‑100k tool blobs in transcript |
| `defaultMaxBytes` (flag, 65536) | not re-run live | Caps read/http bodies per turn when on |
| `pinnedModel` + follow-up | prompt-cache eval pass | `cache2=6784` vs `prompt1=6819` (gate: cache2 ≥ prompt1−1k) |
| `handoffTool` + compact ask | handoff/compact pass | `inputTokens=21636` (gate ≤32k named-read budget) |
| `handoffFork` | unit tests only | TUI fork path covered by `tui/adapters/handoff.test.ts`; no live over-200k fork eval yet |

Latest `context-size` gate metrics (2026-11-03, `93e2162`, nix develop):

| Case | inputTokens | cacheRead | newTokens |
| --- | --- | --- | --- |
| named-read | 26,867 | 14,464 | 12,403 |
| large-read | 21,548 | 16,768 | 4,780 |
| docker-report | 14,668 | 9,728 | 4,940 |
| structured-list | 14,447 | 9,728 | 4,719 |

Toggle comparison: `/ctx list`, `/ctx on resultDigest`, `/ctx off resultDigest` (restart TUI), then repeat `context-size/named-read`.
