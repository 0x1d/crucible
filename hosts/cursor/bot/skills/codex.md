---
description: Use when opening a pull request, composing entry modules, naming a slug, or running the improvement loop. The always-on prompt already lists the codex tools.
---

# Codex authoring

## GitHub pull requests

When the user asks to open a PR and the branch is already pushed:

1. `call_function` once on `github.create_pr` with `cwd` set to the git repo root.
2. Optional args: `base` (default `main`), `head`, `title`, `body`, `draft`.
3. Hand back `url` when present. If the result has `ok: false` and `compare_url`, give the user that compare link and stop.

```json
{
  "name": "github.create_pr",
  "args": {
    "cwd": "/path/to/repo",
    "base": "main",
    "title": "Short title",
    "body": "## Summary\n- …"
  }
}
```

## Composition

1. `find_function` with a tight query.
2. `define_function` for the entry and its deep modules.
3. `call_function` once on the entry slug.

Static composition: `alias` another entry module and call `Other.run(args)` when the slug is known at authoring time.

Dynamic dispatch: `AgentFn.Codex.call/2` only when the slug comes from `args` at runtime.

Do not simulate a pipeline with many `call_function` invocations when one entry module can express it.

## Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Slug | `snake_case` segments with `.` | `my.flow` |
| Path | `functions/my/flow/tool.ex` | |
| Entry module | `AgentFn.My.Flow` with `run/1` | |
| Deep modules | `AgentFn.My.Flow.Steps.*` | no separate slug |
| Shared library | `AgentLib.*` in `functions/lib/` | |

Document entries with `@moduledoc` and `@spec` (synced to `meta.json` on load).

## Improvement loop

1. `find_function`
2. `define_function`
3. `call_function` on the entry slug
4. Refine the source. Split deeper modules when needed.
