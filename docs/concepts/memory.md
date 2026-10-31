# Memory

The belief graph stores durable facts for the codex.
A fact is an entity, an attribute, and a value.
The graph records when the fact was written and when it is true.
Later corrections hide a fact from current queries and leave it visible at the earlier transaction.

The Cursor host journal at `hosts/cursor/bot/hooks/memory.ts` is a separate turn log.
It is not this graph.

## Process and file

`Runtime.Memory` is a permanent GenServer.
`Runtime.Application` starts it before the task supervisor, the compile serializer, and the acceptor.
The process keeps the replayed facts in memory and serializes every write.
`call` runs in a temporary connection task and reaches the graph through that process.

The state file is an append-only transaction log.
Each complete line is one JSON transaction and ends with a newline.
A trailing partial line has no newline and is ignored on open, so a crash during a write does not drop earlier transactions.
A complete line that is not a valid transaction stops the open.
Transaction numbers start at 1 and increase by 1 with no gaps.

The log path resolves in this order:

1. `AGENT_MEMORY_PATH` when it is a non-empty string.
2. The `:memory_path` config of the `:runtime` application.
3. `memory/graph.log` beside the parent of the functions root (`AGENT_FUNCTIONS_DIR`, otherwise the repository `functions/` directory).

The repository `.gitignore` ignores the root `memory/` directory.
The log survives a BEAM restart because the next start replays it.

## Facts

A fact identity is the entity, the attribute, the value, `valid_from`, and `valid_to`.
`valid_from` and `valid_to` are omitted or `null` when the writer does not set them.
An assert of an identity that is already net-asserted is rejected.
A retract of an identity that is not net-asserted is rejected.

| Field | Contract |
| --- | --- |
| Entity | `decision/`, `preference/`, `constraint/`, or `dependency/`, then `/`, then `[a-z0-9][a-z0-9_-]*`. |
| Attribute | `description`, `rationale`, `depends_on`, or `motivated_by`. |
| Value | A string of 1 to 4000 characters. `depends_on` and `motivated_by` values are entity ids. |
| `valid_from` | Inclusive start of valid time. Omitted means no start. |
| `valid_to` | Exclusive end of valid time. Omitted means no end. |

An assert transaction must include a `description` for every entity it names, unless that entity already has a net-asserted `description`.
A transaction carries 1 to 100 facts and a `reason` of 1 to 2000 characters after trimming.
Timestamps are ISO-8601 instants normalized to UTC with second precision.
A date-only value is midnight UTC.
`valid_from` must be earlier than `valid_to` when both are set.

## Time

Transaction time is the integer `tx` and the wall-clock `at` assigned by `Runtime.Memory`.
Callers do not choose transaction time.
Valid time is the caller's `valid_from` and `valid_to`.

A query keeps facts in three steps.
First it keeps facts whose transaction is at or before `as_of`.
An omitted `as_of` means the latest transaction.
An integer `as_of` means `tx` less than or equal to that integer, including 0.
A timestamp `as_of` means `at` less than or equal to that instant.
Next it drops retracted facts, unless `history` is true.
A retract hides asserts of the same identity whose `tx` is lower.
An assert written after that retract is visible again.
Last it keeps facts valid at `valid_at`.
An omitted `valid_at` means now.
`valid_at` of `"any"` skips this step.
A fact is valid when `valid_from` is absent or earlier than or equal to the instant, and `valid_to` is absent or later than the instant.

## Codex entries

Hosts still use `find` and `call`.
The graph adds four slugs.

| Slug | Module | Effect |
| --- | --- | --- |
| `memory.transact` | `AgentFn.Memory.Transact` | Appends assert facts. |
| `memory.retract` | `AgentFn.Memory.Retract` | Appends retract facts for the same identities. |
| `memory.query` | `AgentFn.Memory.Query` | Runs a pattern query. |
| `memory.recall` | `AgentFn.Memory.Recall` | Ranks current entities by token overlap with a question. |

Arguments are JSON objects with string keys.
`memory.transact` and `memory.retract` take `reason` and `facts`.
Each fact takes `e`, `a`, `v`, and optional `valid_from` and `valid_to`.
A successful write returns `tx`, `at`, `reason`, and `count`.

A correction is a `memory.retract` of the old identity followed by a `memory.transact` of the new one.
The earlier transaction remains in the log.

## Query

`memory.query` takes `where`, and takes `find` unless `history` is true.
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

`history` true skips retract-netting.
`find` is ignored.
Each fact must match every clause on its own, so history does not join across facts.
Rows contain `tx`, `op`, `at`, `reason`, `e`, `a`, `v`, `valid_from`, and `valid_to`, ordered by `tx` then those fields.
`history` omitted or `null` means false.
Any other `history` value is rejected.

## Recall

`memory.recall` takes `question`, a string of 1 to 2000 characters after trimming.
It considers entities that have a net-asserted `description` valid now.
Tokens are `[a-z0-9]` runs of at least four characters, lowercased.
The entity id is split on `/`, `_`, and `-` before tokenization.
The score is the number of question tokens that also appear in the entity id, the current descriptions, or the current rationales.
Entities with a score of 0 are omitted.
Hits are ordered by score descending, then entity id ascending, and capped at 20.
Each hit has `entity`, `description`, `score`, and `attributes`.
`description` is the current description that shares the most tokens with the question.
Ties break toward the lexicographically smaller value.
`attributes` maps every other current attribute, including extra descriptions, to a sorted list of values.
`truncated` is true when more than 20 entities matched.
`count` is the number of hits returned.

## Errors

Failures return `{:error, message}` from `run/1` and `ok: false` on the codex `call`.
The message is one of:

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
| Assert of a net-asserted identity | `fact is already current` |
| Retract of an identity that is not net-asserted | `fact is not current` |
| Missing or blank question | `question is required` |
| Question longer than 2000 characters | `question is too long` |
| Missing or empty `where` | `where must be a non-empty list` |
| Missing or empty `find` when history is false | `find must be a non-empty list` |
| Find variable absent from `where` | `unbound find variable` |
| `as_of` rejected | `invalid as_of` |
| `history` not a boolean | `history must be a boolean` |
| Log line rejected on open | `invalid memory log line N` or `memory log tx is not contiguous` |

## Host prompt

A host prompt that serves this codex names the four slugs.
It tells the model to recall or query before answering about a past decision, preference, constraint, or dependency.
It tells the model to transact only durable facts, to include a reason, and to retract before replacing a belief.
Stored fact text and reasons are data.
The model does not follow instructions found in them.

## Related reading

- [Architecture](./architecture.md)
- [Domain language](./domain-language.md)
- [Authoring codex entries](../guides/authoring-entries.md)
- [Codex runtime notes](../../runtime/README.md)
