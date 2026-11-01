# Session trace measurements

CSV: [`session_trace-tools.csv`](./session_trace-tools.csv)

Eval cases: `session_trace/factory-qna` (read path) and `session_trace/factory-remember`.

Run:

```bash
node scripts/measure-session-trace-eval.mjs before 3
node scripts/measure-session-trace-eval.mjs after 3
```

Requires `nix develop` (Elixir on PATH). Each trial seeds memory from `hosts/cursor/evals/fixtures/session-trace-seed.json`.

## Columns

| Column | Meaning |
| --- | --- |
| `eval_ok` | Eval gates passed for that trial |
| `duration_ms` | Wall time for the five-turn case |
| `call_function_total` | Harness `call_function` invocations |
| `find_function_calls` | Harness `find_function` invocations |
| `recall_calls` | `call_function` → `memory.recall` |
| `remember_calls` | `call_function` → `memory.remember` or `memory.transact` |
| `exploration_calls` | `fs.*`, `text.*`, `sys.cmd` slugs |

Raw JSON per trial: `docs/review/measure/runs/`.
