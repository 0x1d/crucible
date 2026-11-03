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
| `pinnedModel` | prompt-cache design | off | Pins server default to `grok-4.7` for stable cache prefix; follow-up cache read should approach full prompt (eval gate). |
| `handoffTool` | handoff design | off | Exposes `handoff` server tool (~schema tokens); model can write `handoff.md`. |
| `handoffFork` | handoff design | off | TUI forks to a new session after handoff when over 200k or user compacted; drops old transcript from live prompt. |
| `toolResultLog` | §7 observability | off | Logs largest tool results per turn to `.agent-serve/context-tool-sizes.log`. |

Already shipped without a flag (measured in the host-context plan):

- Named-path one-shot `fs.read` rule in `instructions.md`.
- Shorter always-on prompt (`bot/skills/*`).
- `docker.ps_report` summary, array/string digests in `call_function`.
- Footer cached/read/write/new split (`tui/view.ts`).

## Verification log

| Check | Status | Notes |
| --- | --- | --- |
| `node --test hosts/cursor/bot/lib/handoff.test.ts` | pass | |
| `node --test tui/adapters/handoff.test.ts` | pass | via npm run test:tui |
| `node --test hosts/cursor/bot/lib/context-improvements.test.ts` | pass | via npm run test:hosts |
| `node --test hosts/cursor/bot/prompt-stability.test.ts` | pass | |
| `npm run test:tui` | pass | 79 tests |
| `npm run test:hosts` | partial | prompt-stability + cursor lib pass; instructions-examples need mix on PATH |
| `npx @grok/agent-sdk validate --dir hosts/cursor` | pass | |
| `npm run eval:cursor -- context-size` | pending | needs Cursor credential + elixir |
| `npm run eval:cursor -- handoff/compact` | pending | enable ALCHEMIST_CTX_handoffTool=1 |
| `npm run eval:cursor -- prompt-cache/pong` | pending | enable ALCHEMIST_CTX_pinnedModel=1 |

## Measurements

Baseline from [cursor host context](2026-11-03-cursor-host-context.md) (2026-11-03, gate evals):

| Improvement | Input tokens (named read gate) | Effect |
| --- | --- | --- |
| Search-before-read (reverted path) | 62,802 fail | Extra tools inflate prompt |
| One-shot named `fs.read` | 29,426 pass | −33k vs search path |
| Shorter instructions / skills | 25,743 pass | −3k |
| `call_function` digest (32k cap + array/string digest) | large read 21,334; docker list 14,256 | Stops multi‑100k tool blobs in transcript |
| `defaultMaxBytes` (flag, 65536) | not re-run live | Caps read/http bodies per turn when on |
| `pinnedModel` + follow-up | prompt-cache eval | Targets cache read ≥ prompt1−1k on turn 2 |
| `handoffFork` | new session seed ≤12kB file + user | Drops prior transcript from live window |

Toggle comparison: `/ctx list`, `/ctx on resultDigest`, `/ctx off resultDigest` (restart TUI), then repeat `context-size/named-read`.
