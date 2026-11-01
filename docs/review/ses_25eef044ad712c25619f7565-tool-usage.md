# Tool usage review: ses_25eef044ad712c25619f7565

Session trace: `hosts/cursor/.agent-serve/cursor/sessions/ses_25eef044ad712c25619f7565/events.ndjson`.

Live HTTP chat, five turns (~2026-11-01T01:24–01:54 UTC).

## Summary

| Turn | User intent | Wall time | Tool calls | Pattern |
| --- | --- | ---: | ---: | --- |
| 1 | Argo CD recap | ~12s | 4 | Discovery + recall (+ bad query) |
| 2 | Stack suggestion | ~10s | 1 | Single `memory.recall` |
| 3 | Lighter than Temporal | ~13s | 1 | Single `memory.recall` |
| 4 | Git integration points | ~10s | 1 | Single `memory.recall` |
| 5 | Remember these | ~45s | 19 | Failed writes → repo spelunking → success |

**Totals:** 26 harness results (23× `call_function`, 3× `find_function`).

Harness `isError` stayed false even when codex returned `ok: false`, so the model treated failures as soft and kept exploring.

## What worked

Turns 2–4 followed instructions: one `memory.recall` per turn in ~10–13s.

Turn 1 recall answered the Argo CD question.

Turn 5 eventually persisted facts with `facts: [{ e, a, v }, …]`.

## Failures and waste

### Wrong memory API shapes

Turn 1 used `memory.query` with `where` as a map (`description_contains`) instead of a clause list.

Turn 5 tried top-level `entity` / `description` on `memory.transact`, empty facts, and malformed `datalog` before succeeding.

### Turn 5 exploration (largest cost)

After validation errors the agent ran 14 action batches including:

- `find_function` with `{}` → ~21KB catalog (33 entries)
- `fs.*`, `text.slice`, `sys.cmd` / `rg` on runtime and core sources
- `text.grep` on directories → `:eisdir`

Instructions already say orchestration belongs in codex entries, not long `call_function` chains, and not to infer schema from source on validation errors.

### Recall payload duplication

Turns 2–4 each returned ~6.6KB recall payloads with `count: 10` and largely overlapping hits.

## Optimization targets

1. Document `memory.transact`, `memory.query`, and `memory.remember` with copy-paste JSON in `hosts/cursor/bot/instructions.md`.
2. Add `memory.remember` codex entry for batch asserts in one call.
3. Tighten `memory.recall` default hit cap and support an optional `limit`.
4. Slim `find_function` responses (name + one-line summary, default limit 12); reject empty queries; full metadata only with `detail: true` or `codex.docs`.
5. Mark codex `ok: false` as tool errors in Cursor harness tools.
6. Fix `text.grep` when `path` is a directory.
7. Lock behavior with `hosts/cursor/evals/session_trace.eval.ts` and CSV runs under `docs/review/measure/`.

## Eval replay

The eval `session_trace/factory-thread` replays the five user messages against a seeded MiniGraf fixture (`hosts/cursor/evals/fixtures/session-trace-seed.json`).

Measurements live in `docs/review/measure/session_trace-tools.csv`.

### Baseline (`before`, three trials)

| Trial | eval_ok | duration_ms | call_function | find_function | recall | remember | exploration |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (outlier) | false | 230904 | 36 | 3 | 9 | 23 | 0 |
| 1 | false | 88179 | 11 | 3 | 8 | 2 | 0 |
| 2 | false | 101925 | 12 | 3 | 8 | 2 | 0 |

Typical baseline: ~11–12 `call_function` calls per five-turn replay, ~90–100s, eval gates failed on tool budget and missing `memory.remember`.

### After optimizations (`after`, three trials)

| Trial | eval_ok | duration_ms | call_function | find_function | recall | remember | exploration |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | false | 66419 | 6 | 0 | 4 | 1 | 0 |
| 2 | false | 47000 | 8 | 0 | 5 | 1 | 0 |
| 3 | true | 49138 | 8 | 0 | 5 | 2 | 0 |

Median improvement: about **40% faster** (~95s → ~49s) and **~35% fewer** `call_function` calls (~11 → ~8), with **zero** catalog-wide `find_function` and **zero** filesystem exploration slugs.

Implemented levers: instruction examples, `memory.remember`, tighter recall default (`limit` 8), slim `find`, codex harness `isError` on `ok: false`, `text.grep` on directories, and the session_trace eval gates.

## `find_function` and context

Historically each hit returned full `meta.json` (moduledoc, specs, module, timestamps).
A broad search on ~33 entries cost **~21KB** in the live session.

Slim `find` (default) returns `{ name, summary, loaded }` with **limit 12** and `truncated`.
Example on this tree: query `memory` drops from ~2050 B (full) to ~550 B (slim).

Use **`codex.docs`** or **`find` with `detail: true`** when the agent needs specs—not before every `call_function`.
