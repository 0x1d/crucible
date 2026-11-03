# Context window improvements — implementation progress (2026-11-03)

Tracks work from [cursor host context](2026-11-03-cursor-host-context.md),
[context handoff](../specs/2026-11-03-context-handoff-design.md),
[prompt cache](../specs/2026-11-03-prompt-cache-design.md), and related plans.

Toggle host flags with `/flags` (or `/ctx`) in the TUI or edit
`hosts/cursor/.agent-serve/host-flags.json` (legacy `context-improvements.json` is still read).
Serve-side flags apply on the next `serve()` start (restart the TUI or `/host`).

Eval overrides use `ALCHEMIST_HOST_FLAG_<SNAKE_CASE>` (`hostFlagEnvKey()` in `hosts/cursor/bot/lib/host-flags.ts`).
Legacy `ALCHEMIST_CTX_*` env names are still accepted.

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
| `nix develop -- ALCHEMIST_CTX_HANDOFF_TOOL=1 npm run eval:cursor -- handoff/compact` | pass | writes `handoff.md`; gate on tool output; `inputTokens≈21608` |
| `nix develop -- ALCHEMIST_CTX_PINNED_MODEL=1 npm run eval:cursor -- prompt-cache/pong` | pass | `prompt1=6575`, `cache2=6592` (≥ prompt1−1k) |
| `npm run test` (nix develop) | pass | runtime 28 + functions 32 + node suites; cursor instructions examples skipped (no `### Examples`) |
| `npm run eval:cursor -- memory` | pass | |
| `npm run eval:cursor -- memory-time` | pass | 3/3 |
| `node scripts/measure-call-function.mjs` (digest A/B) | pass | digest on **1782** B vs off **144150** B; off + `DEFAULT_MAX_BYTES` **66609** B |
| `npm run eval:cursor -- context-size` (no nix) | fail | 0/4; reply gates fail on `spawn elixir ENOENT` |

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

## Effectiveness (2026-11-03, nix develop)

| Lever | Measurement | Verdict |
| --- | --- | --- |
| **Always-on prompt** (named read, one-shot `fs.read`) | `context-size/named-read` **26–27k** input vs search-before-read **62.8k** (historical fail) | **High** — keeps gate under 32k |
| **`resultDigest` (default on)** | Tool output **1.8kB** vs **144kB** off; eval `large-read` **~21.5k** tokens on vs **59.9k** off (6 tools, budget fail) | **High** — ~81× smaller tool blob; prevents runaway turns when off |
| **`defaultMaxBytes` alone** | With digest on, `large-read` **~21.6k** (same as baseline); with digest off, **148k** tokens and 13 tools (worse than digest-only off) | **Low alone** when digest stays on; **partial** as safety net when digest off (**66kB** tool payload vs **144kB**) |
| **`handoffTool`** | Disabled: model may still call `handoff` (error). Enabled: **802 B** `handoff.md`, same turn budget as named read | **Medium** — compaction path works; eval now requires successful write |
| **`pinnedModel` + cache** | Turn 2 **cache read ≈ full prompt** (`6592` read vs `6575` prompt1) | **High** for multi-turn cost/latency when flag on |
| **`toolResultLog`** | Not re-run (needs `ALCHEMIST_CTX_TOOL_RESULT_LOG=1` on serve) | Observability only |
| **`handoffFork`** | Not live-tested | Design: drop old transcript after handoff; covered by unit tests |

Env override naming: camelCase ids map to `ALCHEMIST_CTX_SNAKE_CASE` (see header). Wrong names silently leave defaults.

Latest `context-size` gate metrics (2026-11-03, `93e2162`, nix develop):

| Case | inputTokens | cacheRead | newTokens |
| --- | --- | --- | --- |
| named-read | 26,867 | 14,464 | 12,403 |
| large-read | 21,548 | 16,768 | 4,780 |
| docker-report | 14,668 | 9,728 | 4,940 |
| structured-list | 14,447 | 9,728 | 4,719 |

Toggle comparison: `/ctx list`, `/ctx off resultDigest` (restart TUI), then
`ALCHEMIST_CTX_RESULT_DIGEST=0 npm run eval:cursor -- context-size/large-read`
vs default (digest on). Deterministic tool sizing:
`nix develop -- node scripts/measure-call-function.mjs`.
