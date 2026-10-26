# Elixir codebase review guide

Use this document when performing a **full or deep review** of Elixir code in this repository (primarily under `runtime/` and `functions/`). It is a checklist of official [Elixir anti-patterns](https://elixir.hexdocs.pm/what-anti-patterns.html) (code smells): what to look for, a one-line summary, and where to read examples and refactoring steps.

Matching an anti-pattern does **not** mean the code must be rewritten. Prefer incremental improvements with clear benefit; cite the linked guide when recommending a change.

Ignore `docs/internal/` unless you are updating historical records.

## Alchemist registry runtime checklist

When reviewing `runtime/`, treat the live service as the **`:runtime` OTP application** (registry runtime) on a long-lived BEAM. The `runtime/` tree is a **Mix project** used to build and test that application — **Mix is not the runtime**.

| ID | Pattern | Prefer |
| --- | --- | --- |
| R1 | Mix scaffold (`hello/0`, placeholder `@moduledoc`) in shipped apps | Root module documents the app; no dead APIs |
| R2 | Duplicated `try/rescue/catch` for JSON error envelopes | `Runtime.Result.wrap/1` (or one helper) |
| R3 | `Jason.decode!/1` on disk metadata (`meta.json`) | `Jason.decode/1` with fallback record |
| R4 | Docs name the wrong OTP owner (e.g. BEAM = only `Runtime.Server`) | Match supervision: acceptor, serializer, task supervisor |
| R5 | `@moduledoc false` on modules hosts/operators read | Brief moduledoc on public-facing modules |
| R6 | Version skew (`mix.exs` Elixir vs repo AGENTS/README) | Align minimum Elixir with dev environment |
| R7 | Tests coupled to placeholder doctests | Test real invariants (supervision, protocol) |
| R8 | Calling the live `:runtime` service a "Mix control plane" | **Registry runtime** for the OTP app; **Mix project** only for `runtime/` builds |

```bash
(cd runtime && mix test)
node scripts/registry-cli.mjs '{"op":"call","name":"echo","args":{"hello":"world"}}'
npm run check
```

## How to review

Each linked hexdocs entry follows the same shape: **Problem** (why it hurts), **Example**, **Refactoring** (sometimes **Additional remarks**). The tables below are the working checklist; use detail links only when you need the full example or refactor steps for a finding.

1. Scan the categories below while reading modules under review.
2. For each hit, use that row’s **detail link** for examples and refactoring guidance.
3. Record findings with: file/location, anti-pattern name, severity (bug risk / maintainability / performance), and suggested direction (not necessarily a full patch).
4. After structural changes, run `cd runtime && mix test` and `npm run check` when the review touches the BEAM runtime or cross-language boundaries.

Background on the catalog (categories, when to fix vs leave): [What are anti-patterns?](https://elixir.hexdocs.pm/what-anti-patterns.html).

For security-sensitive Elixir and web concerns beyond this catalog, see the [Erlang Ecosystem Foundation security resources](https://erlef.github.io/security-wg/).

## Code-related anti-patterns

[Full guide: Code-related anti-patterns](https://elixir.hexdocs.pm/code-anti-patterns.html)

| Anti-pattern | Look for | Detail |
| --- | --- | --- |
| [Comments overuse](https://elixir.hexdocs.pm/code-anti-patterns.html#comments-overuse) | Comments restating obvious steps instead of clear names, `@moduledoc`/`@doc` for API docs | Noise hides intent; prefer naming and module attributes over line comments |
| [Complex `else` clauses in `with`](https://elixir.hexdocs.pm/code-anti-patterns.html#complex-else-clauses-in-with) | One `else` handling errors from many `<-` clauses | Hard to trace which step failed; normalize errors in private helpers |
| [Complex extractions in clauses](https://elixir.hexdocs.pm/code-anti-patterns.html#complex-extractions-in-clauses) | Many fields extracted in heads across clauses | Unclear what is for guards vs body; bind struct once, extract in body |
| [Dynamic atom creation](https://elixir.hexdocs.pm/code-anti-patterns.html#dynamic-atom-creation) | `String.to_atom/1` on external or unbounded input | Atoms are not GC’d; risk of memory exhaustion; map to known atoms or `String.to_existing_atom/1` |
| [Long parameter list](https://elixir.hexdocs.pm/code-anti-patterns.html#long-parameter-list) | Public functions with many positional args | Group into maps/structs; split responsibilities |
| [Namespace trespassing](https://elixir.hexdocs.pm/code-anti-patterns.html#namespace-trespassing) | Library modules outside the package namespace (e.g. `Plug.*` in `:plug_auth`) | VM loads one module name; prefix with your app (`PlugAuth.*`) |
| [Non-assertive map access](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-map-access) | `map[:required_key]` when the key must exist | `nil` propagates; use `map.key`, pattern matching, or structs |
| [Non-assertive pattern matching](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-pattern-matching) | Defensive code that returns wrong values on bad input | Prefer match/guards and `case` on `{:ok,_}` / `{:error,_}`; avoid catch-all `_` that hides new outcomes |
| [Non-assertive truthiness](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-truthiness) | `&&` / `||` / `!` when both sides are booleans | Use `and` / `or` / `not` for boolean logic; important at Erlang boundaries |
| [Structs with 32 fields or more](https://elixir.hexdocs.pm/code-anti-patterns.html#structs-with-32-fields-or-more) | Large `defstruct` lists | BEAM switches map representation; nest optional fields or sub-structs |

## Design-related anti-patterns

[Full guide: Design-related anti-patterns](https://elixir.hexdocs.pm/design-anti-patterns.html)

| Anti-pattern | Look for | Detail |
| --- | --- | --- |
| [Alternative return types](https://elixir.hexdocs.pm/design-anti-patterns.html#alternative-return-types) | Options that change the function’s return shape | Split into named functions per return type |
| [Boolean obsession](https://elixir.hexdocs.pm/design-anti-patterns.html#boolean-obsession) | Multiple boolean flags with overlapping meaning (`admin`, `editor`, …) | Prefer a single atom field (`:role`, `:status`, …) |
| [Exceptions for control-flow](https://elixir.hexdocs.pm/design-anti-patterns.html#exceptions-for-control-flow) | `try/rescue` for expected failures | Use tuple-return APIs (`File.read/1` not `read!/1`); reserve exceptions for exceptional cases |
| [Primitive obsession](https://elixir.hexdocs.pm/design-anti-patterns.html#primitive-obsession) | Strings/numbers carrying rich domain meaning | Introduce structs/maps and parse at boundaries |
| [Unrelated multi-clause function](https://elixir.hexdocs.pm/design-anti-patterns.html#unrelated-multi-clause-function) | One function name, clauses for unrelated types/rules | Split by name or module; keep clauses for variants of the same rule |
| [Using application configuration for libraries](https://elixir.hexdocs.pm/design-anti-patterns.html#using-application-configuration-for-libraries) | `Application.get_env` inside library code for per-caller behavior | Pass options or child specs; let apps read config when starting children |

## Process-related anti-patterns

[Full guide: Process-related anti-patterns](https://elixir.hexdocs.pm/process-anti-patterns.html)

| Anti-pattern | Look for | Detail |
| --- | --- | --- |
| [Code organization by process](https://elixir.hexdocs.pm/process-anti-patterns.html#code-organization-by-process) | `GenServer` used only to group pure functions | Processes model concurrency/state; use modules for organization |
| [Scattered process interfaces](https://elixir.hexdocs.pm/process-anti-patterns.html#scattered-process-interfaces) | `Agent`/`GenServer.call` spread across many modules | Centralize in one module; enforce state shape (formerly “Agent obsession”) |
| [Sending unnecessary data](https://elixir.hexdocs.pm/process-anti-patterns.html#sending-unnecessary-data) | Large structs captured in `spawn`, `Task`, or messages | Copy full message payload; bind only needed fields before the closure |
| [Unsupervised processes](https://elixir.hexdocs.pm/process-anti-patterns.html#unsupervised-processes) | Long-lived `start_link` outside a supervision tree | Start under `Application` / `Supervisor` for ordering, restarts, and shutdown |

## Meta-programming anti-patterns

[Full guide: Meta-programming anti-patterns](https://elixir.hexdocs.pm/macro-anti-patterns.html)

| Anti-pattern | Look for | Detail |
| --- | --- | --- |
| [Compile-time dependencies](https://elixir.hexdocs.pm/macro-anti-patterns.html#compile-time-dependencies) | Macros that pull modules into compile deps unnecessarily | Expand literals at use site when safe; check with `mix xref` |
| [Large code generation](https://elixir.hexdocs.pm/macro-anti-patterns.html#large-code-generation) | Macros inlining big `quote` blocks per invocation | Delegate to functions (`__define__/3` pattern) |
| [Unnecessary macros](https://elixir.hexdocs.pm/macro-anti-patterns.html#unnecessary-macros) | Macros where functions suffice | Reduces readability and tooling support |
| [`use` instead of `import`](https://elixir.hexdocs.pm/macro-anti-patterns.html#use-instead-of-import) | `__using__` that imports unrelated modules into callers | Prefer explicit `import`/`alias`; document `use` in `@moduledoc` |
| [Untracked compile-time dependencies](https://elixir.hexdocs.pm/macro-anti-patterns.html#untracked-compile-time-dependencies) | `Module.concat` or dynamic module atoms at compile time | Stale builds; use explicit module lists or `unquote` in macros |

## Quick index (alphabetical)

- [Alternative return types](https://elixir.hexdocs.pm/design-anti-patterns.html#alternative-return-types)
- [Boolean obsession](https://elixir.hexdocs.pm/design-anti-patterns.html#boolean-obsession)
- [Code organization by process](https://elixir.hexdocs.pm/process-anti-patterns.html#code-organization-by-process)
- [Comments overuse](https://elixir.hexdocs.pm/code-anti-patterns.html#comments-overuse)
- [Compile-time dependencies](https://elixir.hexdocs.pm/macro-anti-patterns.html#compile-time-dependencies)
- [Complex `else` clauses in `with`](https://elixir.hexdocs.pm/code-anti-patterns.html#complex-else-clauses-in-with)
- [Complex extractions in clauses](https://elixir.hexdocs.pm/code-anti-patterns.html#complex-extractions-in-clauses)
- [Dynamic atom creation](https://elixir.hexdocs.pm/code-anti-patterns.html#dynamic-atom-creation)
- [Exceptions for control-flow](https://elixir.hexdocs.pm/design-anti-patterns.html#exceptions-for-control-flow)
- [Large code generation](https://elixir.hexdocs.pm/macro-anti-patterns.html#large-code-generation)
- [Long parameter list](https://elixir.hexdocs.pm/code-anti-patterns.html#long-parameter-list)
- [Namespace trespassing](https://elixir.hexdocs.pm/code-anti-patterns.html#namespace-trespassing)
- [Non-assertive map access](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-map-access)
- [Non-assertive pattern matching](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-pattern-matching)
- [Non-assertive truthiness](https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-truthiness)
- [Primitive obsession](https://elixir.hexdocs.pm/design-anti-patterns.html#primitive-obsession)
- [Scattered process interfaces](https://elixir.hexdocs.pm/process-anti-patterns.html#scattered-process-interfaces)
- [Sending unnecessary data](https://elixir.hexdocs.pm/process-anti-patterns.html#sending-unnecessary-data)
- [Structs with 32 fields or more](https://elixir.hexdocs.pm/code-anti-patterns.html#structs-with-32-fields-or-more)
- [Unnecessary macros](https://elixir.hexdocs.pm/macro-anti-patterns.html#unnecessary-macros)
- [Unrelated multi-clause function](https://elixir.hexdocs.pm/design-anti-patterns.html#unrelated-multi-clause-function)
- [Unsupervised processes](https://elixir.hexdocs.pm/process-anti-patterns.html#unsupervised-processes)
- [Untracked compile-time dependencies](https://elixir.hexdocs.pm/macro-anti-patterns.html#untracked-compile-time-dependencies)
- [Using application configuration for libraries](https://elixir.hexdocs.pm/design-anti-patterns.html#using-application-configuration-for-libraries)
- [`use` instead of `import`](https://elixir.hexdocs.pm/macro-anti-patterns.html#use-instead-of-import)
