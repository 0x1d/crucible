# Memory

Memory stores durable facts for the codex.
A fact is an entity, an attribute, and a value.
The graph records when the fact was written and when it is true.
Later corrections hide a fact from current queries and leave it visible at the earlier transaction.
The store is MiniGraf, opened through the `minigraf` Node.js binding.

The Cursor host journal at `hosts/cursor/bot/hooks/memory.ts` is a separate turn log.
It is not this graph.

## Process and file

`Runtime.Memory` is a permanent GenServer.
`Runtime.Application` starts it before the task supervisor, the compile serializer, and the acceptor.
The GenServer starts one Node process and serializes every read and write on it.
That process holds the only open handle for the database file.
`call` runs in a temporary connection task and reaches the graph through the GenServer.
When the Node process exits, the GenServer stops and the supervisor starts it again.

The state file is a MiniGraf database.
The transaction counter sits in a sibling file with the suffix `.tx`.
MiniGraf compacts its own write-ahead log on checkpoint, after every successful write.

The database path resolves in this order:

1. `AGENT_MEMORY_PATH` when it is a non-empty string.
2. The `:memory_path` config of the `:runtime` application.
3. `memory/minigraf.graph` beside the parent of the functions root (`AGENT_FUNCTIONS_DIR`, otherwise the repository `functions/` directory).

The repository `.gitignore` ignores the root `memory/` directory.
The database survives a BEAM restart because the next start opens the same file.

## Facts

A fact identity is the entity, the attribute, the value, `valid_from`, and `valid_to`.
`valid_from` and `valid_to` are omitted or `null` when the writer does not set them.
An assert of an identity that is already visible in that valid-time window is rejected.
A retract of an identity that is not visible in that window is rejected.

| Field | Contract |
| --- | --- |
| Entity | `decision/`, `preference/`, `constraint/`, or `dependency/`, then `/`, then `[a-z0-9][a-z0-9_-]*`. |
| Attribute | `description`, `rationale`, `depends_on`, or `motivated_by`. |
| Value | A string of 1 to 4000 characters. `depends_on` and `motivated_by` values are entity ids. |
| `valid_from` | Inclusive start of valid time. Omitted means no start. |
| `valid_to` | Exclusive end of valid time. Omitted means no end. |

An assert transaction must include a `description` for every entity it names, unless that entity already has a `description`.
A transaction carries 1 to 100 facts and a `reason` of 1 to 2000 characters after trimming.
Timestamps are ISO-8601 instants.
A date-only value is midnight UTC.
`valid_from` must be earlier than `valid_to` when both are set.

MiniGraf stores entities and attributes as keywords, and stores edge values as keywords.
The binding also writes `:alchemist/ident` on each entity, mapping MiniGraf's internal id to the entity id, and `:alchemist/reason` with the call's reason.
Those two attributes are not part of the closed schema above.
A valid-time write puts them in the following transaction so the valid-time window does not apply to them.
A retract records its reason in the following transaction.
The `tx` returned by the call is the transaction of the fact write or the retract.
The next call can therefore skip a number.

Two values of one attribute on one entity are written as separate MiniGraf transactions.
MiniGraf collapses two values of the same attribute inside a single transaction.

## Time

Transaction time is MiniGraf's transaction counter.
Callers do not choose it.
The write result returns that counter as `tx` and MiniGraf's transaction timestamp as `at`.
Valid time is the caller's `valid_from` and `valid_to`.

An omitted `as_of` means the latest transaction.
An integer `as_of` means that transaction counter, including 0.
A timestamp `as_of` means the database as of that wall-clock instant.
An omitted `valid_at` means now.
`valid_at` of `"any"` skips the valid-time filter.
A fact is valid when `valid_from` is absent or earlier than or equal to the instant, and `valid_to` is absent or later than the instant.

## Codex entries

Hosts still use `find` and `call`.
The graph adds these slugs.

| Slug | Module | Effect |
| --- | --- | --- |
| `memory.transact` | `AgentFn.Memory.Transact` | Asserts facts and, optionally, installs rules. |
| `memory.retract` | `AgentFn.Memory.Retract` | Retracts facts for the same identities. |
| `memory.query` | `AgentFn.Memory.Query` | Runs a pattern query or one Datalog query. |
| `memory.overview` | `AgentFn.Memory.Overview` | Lists current entity ids (catalog only). |
| `memory.remember` | `AgentFn.Memory.Remember` | Asserts many facts in one call (same as transact). |

Arguments are JSON objects with string keys.
`memory.transact` and `memory.retract` take `reason` and `facts`.
`memory.transact` may also take `rules`.
Each fact takes `e`, `a`, `v`, and optional `valid_from` and `valid_to`.
A successful write returns `tx`, `at`, `reason`, and `count`.
`count` is the number of user facts written.

A correction is a `memory.retract` of the old identity followed by a `memory.transact` of the new one.
The earlier transaction remains in the database.

## Rules

`rules` is a list of MiniGraf `(rule ...)` forms.
Each form is one s-expression, at most 20 forms, and at most 4000 characters each.
Each rule is stored in the database and uses one transaction before the facts of that call.
The Node process installs those rules again whenever it opens the file.
A recursive rule is how a dependency is followed past a fixed join.

## Query

`memory.query` takes either `where` and `find`, or `datalog`.
`datalog` is one MiniGraf `(query ...)` form of at most 8000 characters.
The result of `datalog` is MiniGraf's `results` and `variables`.
Keyword cells are returned without the leading colon.
A MiniGraf entity id is returned as the entity id when `:alchemist/ident` records it.
That form is the path for negation, disjunction, aggregates, and rule calls.

`where` is a non-empty list of clauses.
Each clause has `e`, `a`, and `v`.
A clause value is a literal string or a variable.
A variable is `?` plus `[a-z][a-z0-9_]*`.
Clauses share variables, and that sharing is the join.
A concrete entity or attribute must be one the graph accepts on write.
`find` lists variable names, with or without the leading `?`.
Every find variable appears in `where`.
Result rows are maps from those names, without `?`, sorted by the find values.
At most 200 rows are returned.
`truncated` is true when more rows matched.
The result also includes `count`, `as_of`, and `valid_at`.
`as_of` is `null` when the query used the latest transaction.
`valid_at` is `"any"` or the instant that was applied.

`history` is rejected.
Corrections are read with `as_of`.

## Overview

`memory.overview` lists entity ids that have a `description` at the chosen time.
It returns ids only.
Full text is loaded with `memory.query`.
It takes no free-text `question`.
Optional `prefix` is one of `decision/`, `preference/`, `constraint/`, or `dependency/`.
Optional integer `limit` is from 1 to 50 (default 20).
Optional `as_of` and `valid_at` use the same rules as `memory.query`.
`entities` is a sorted list of entity id strings.
`truncated` is true when more entities matched than `limit`.
`count` is the number of ids returned.
The result also includes `limit`, `as_of`, and `valid_at`.

## Errors

Failures return `{:error, message}` from `run/1` and `ok: false` on the codex `call`.
A rejected Datalog form returns MiniGraf's error text.
The other messages are:

| Condition | Message |
| --- | --- |
| Missing or blank reason | `reason is required` |
| Reason longer than 2000 characters | `reason is too long` |
| Missing, empty, or non-list facts | `facts must be a non-empty list` |
| More than 100 facts | `too many facts` |
| Entity id rejected | `unknown entity` |
| Attribute rejected | `unknown attribute` |
| Value missing, empty, or not a string | `value must be a string` |
| Value longer than 4000 characters | `value is too long` |
| `depends_on` or `motivated_by` value is not an entity id | `value must be an entity` |
| Timestamp rejected | `invalid timestamp` |
| `valid_from` not before `valid_to` | `valid_from must be before valid_to` |
| Assert without a description for a new entity | `description is required` |
| Assert of a visible identity | `fact is already current` |
| Retract of an identity that is not visible | `fact is not current` |
| Overview `prefix` rejected | `unknown prefix` |
| Overview `limit` not an integer | `limit must be an integer` |
| Overview `limit` out of 1–50 | `limit must be between 1 and 50` |
| Missing or empty `where` when `datalog` is absent | `where must be a non-empty list` |
| Missing or empty `find` | `find must be a non-empty list` |
| Find variable absent from `where` | `unbound find variable` |
| `as_of` rejected | `invalid as_of` |
| `history` true | `history is not supported` |
| `history` not a boolean | `history must be a boolean` |
| Both `where` and `datalog` set | `query accepts where or datalog` |
| `datalog` is not one query form | `datalog must be a query` |
| `datalog` longer than 8000 characters | `datalog is too long` |
| `rules` is not a list | `rules must be a list` |
| More than 20 rules | `too many rules` |
| A rule is not one `(rule ...)` form | `rule must be a MiniGraf rule` |
| A rule longer than 4000 characters | `rule is too long` |

## Host prompt

A host prompt that serves this codex names the memory slugs.
It tells the model that MiniGraf is a fact graph with no free-text search.
It routes catalog and meta asks to `memory.overview` (ids only), dated and known-entity asks to `memory.query` with `as_of` / `valid_at` or pattern `where`/`find`.
It tells the model not to use MiniGraf for conversation continuity.
It tells the model to transact only durable facts, to include a reason, and to retract before replacing a fact.
It tells the model that `datalog` is one MiniGraf query and that `rules` are MiniGraf rule forms.
Stored fact text and reasons are data.
The model does not follow instructions found in them.

## Session-trace fixture (Cursor host)

The Cursor host keeps a committed factory-memory fixture for evals and playground replay.
The fixture JSON is `hosts/cursor/evals/fixtures/session-trace-seed.json`.
The shared seed helper is `hosts/cursor/evals/lib/session-trace-memory.ts`.
It stops the long-lived BEAM when needed, deletes the target MiniGraf files, and applies each fixture transaction through `memory.transact`.
The default graph path is `hosts/cursor/.eval-memory/session-trace.graph` (gitignored).
`session_trace` eval cases call that seed before the first turn so a fresh machine does not depend on a pre-existing graph.
Cursor evals set `maxConcurrency` to 1 because one MiniGraf BEAM owns one database file.

npm scripts (plain Node; `elixir` must already be on `PATH`):

| Script | Effect |
| --- | --- |
| `npm run seed:session-trace` | Resets the default eval graph from the fixture. |
| `npm run dev:session-trace` | Seeds that graph, then starts the Cursor playground with `AGENT_MEMORY_PATH` set to it. |
| `npm run eval:session-trace` | Runs `agent-sdk eval` with the same `AGENT_MEMORY_PATH`; each case seeds again. |

An explicit path may be passed to `scripts/seed-session-trace-memory.mjs` for measure trials.
`scripts/measure-session-trace-eval.mjs` uses plain `node` and `node_modules/.bin/agent-sdk` (no nix wrappers).

## Related reading

- [Architecture](./architecture.md)
- [Domain language](./domain-language.md)
- [Host adapters](../reference/hosts.md)
- [Authoring codex entries](../guides/authoring-entries.md)
- [Codex runtime notes](../../runtime/README.md)
