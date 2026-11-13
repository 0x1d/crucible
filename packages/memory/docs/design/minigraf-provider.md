---
id: crucible/packages/memory/design/minigraf-provider
title: Minigraf Provider
type: DES
owner: crucible/packages/memory
status: Draft
date: 2026-11-13
depends: [crucible/packages/memory/requirements, crucible/packages/memory/interfaces/memory-api, crucible/alchemist/runtime/design/memory]
related: [crucible/packages/memory/interfaces/line-protocol, crucible/homunculus/decisions]
planned: []
---

# Minigraf Provider

**Planned** crucible/P-04

The minigraf provider stores memory as bi-temporal facts in a MiniGraf database file, opened through the `minigraf` npm binding in the consuming process. An item of the memory API is an entity of the graph; its text is the entity's `description`. A schema profile decides which entities and attributes a graph accepts. The fact operations are alchemist's, unchanged; recall and extraction are new and replace what homunculus got from the temporal-reasoning server.

## 1 Graph file and process

| Item | Value |
| --- | --- |
| Engine | `minigraf` npm binding, 2.0.x (`MiniGrafDb`) |
| File | One MiniGraf database per space |
| Transaction counter | Sibling file with the suffix `.tx`; advanced after MiniGraf accepts a write, reconciled against the graph on open |
| Handle | Exactly one per file (crucible/C-02): the space object in the process that opened it. A second `open` of the same file in the process fails with `memory space is already open` |
| Checkpoint | After every successful write and on `close` |
| Rules | Stored in the graph and installed again on open |
| Capabilities | `facts: true`, `temporal: true`, `extraction` when a sampler was given |

The rules for facts, valid and transaction time, retraction, rules, query, overview and their error messages are those of [crucible/alchemist/runtime/design/memory](../../../../projects/alchemist/docs/runtime/design/memory.md), sections Facts to Errors. They are the provider's contract; crucible/P-04 slice 2 moves those sections into this document, and the runtime document keeps the process, the file path and the codex entries. Where they name the entity kinds and attributes, the profile's sets apply (section 2).

## 2 Profiles and item mapping

A profile is a data object: entity kinds, attributes, edge attributes, tags, the prompt section and the extraction guide. Both profiles share the four entity kinds `decision`, `preference`, `constraint`, `dependency`, the id form `<kind>/<slug>` with its canonicalisation, and the system attributes `ident` and `entity-type`.

| | `engineering` | `personal` |
| --- | --- | --- |
| Used by | alchemist | homunculus |
| Attributes | `description`, `rationale`, `depends-on`, `motivated-by`, `governs`, `supersedes`, `source-session` | `description`, `rationale`, `alias`, `date` |
| Edge attributes (value is an entity id) | `depends-on`, `motivated-by`, `governs`, `supersedes` | none |
| Tags | none | `type/person`, `type/place` on `constraint` entities (crucible/homunculus/D-28) |
| Recall fields | `description`, entity id | `description`, `alias`, entity id |
| Session stamp | `meta.session` is written as `source-session` | not recorded |
| Prompt section | Fact graph for engineering decisions: what to store, how to query, retract before replacing | Memory of one user: recall block, automatic extraction, when to write by hand, people and places |
| Extraction guide | Decisions, preferences, constraints and dependencies of the work at hand | The guide of `projects/homunculus/server/src/memory/sampler.ts`: what the user stated or confirmed about their life, absolute dates, no inferred gender |

The attribute sets are the ones in use today (crucible/AD-28, crucible/OI-04).

**Tags.** A tag is a second value of the system attribute `entity-type` on an entity. `entity-type` stays read-only in fact writes; a tag is written through the item attribute `type` or the `tags` field of `memory_transact`, and only the profile's tags are accepted. Today homunculus writes person and place tags in a separate transaction after extraction because the temporal-reasoning server overwrites them; the provider writes them with the entity.

**Item to entity.**

| `MemoryItem` | Graph |
| --- | --- |
| `ref` | Entity id, canonicalised. On input without `ref`: `<kind>/<slug of the first six words of text>`; `kind` is then required |
| `kind` | The id prefix |
| `text` | `description` |
| `attributes` | The entity's other current attributes; `type` holds its tags. A multi-valued attribute is an array |
| `validFrom`, `validTo` | The valid-time window of the `description` fact |
| `score` | Recall score (section 4) |

**Storing an item** (`retain({ items })` and the result of extraction): for each attribute of the item, compared with the entity's current facts:

| Current state | Action |
| --- | --- |
| No current value | Assert the fact |
| Same value | Nothing; the item counts as stored |
| Different value, single-valued attribute (`description`, `rationale`, `date`, `source-session`) | Close the current fact now, then assert the new one. The old value stays visible at earlier valid times |
| Different value, multi-valued attribute (edges, `alias`, tags) | Assert the additional value |

An item is validated completely before any of its facts is written; an invalid item is rejected as a whole with the provider's message. The transaction reason is `meta.reason`, or `retain` when none is given.

## 3 Fact operations and tools

The provider's native operations are `transact`, `retract`, `query` and `overview`, with the arguments and results of [crucible/alchemist/runtime/design/memory](../../../../projects/alchemist/docs/runtime/design/memory.md). The line server exposes them as operations; `tools()` exposes them to an agent:

| Tool | Operation | Policy |
| --- | --- | --- |
| `memory_query` | `query`: `where` and `find`, or one `datalog` form; `as_of`, `valid_at` | allow |
| `memory_transact` | `transact`: `reason`, `facts`, optional `rules`, optional `tags` | allow |
| `memory_retract` | `retract`: `reason`, `facts`, `mode` (`close`, `correct`), `valid_at` | allow |
| `memory_overview` | `overview`: `prefix`, `limit`, `as_of`, `valid_at` | allow |

A tool call returns the operation's result as JSON text, or `ok: false` with the error message. Tool writes update the recall index like any other write.

For homunculus this replaces the tools `minigraf_query`, `minigraf_transact`, `minigraf_retract` and `minigraf_rule`, which take Datalog text. Rules are installed through `rules` of `memory_transact`. The `personal` prompt section describes the JSON forms.

## 4 Recall

Recall is lexical, as the retrieval of temporal-reasoning is. It needs no model and no embedding.

| Item | Value |
| --- | --- |
| Documents | One per entity that has a current `description`: the profile's recall fields joined (description, aliases, the words of the id slug) |
| Tokens | Lowercased runs of Unicode letters and digits; no stemming, no stop words |
| Ranking | BM25 (`k1` 1.2, `b` 0.75) over those documents; entities with score 0 are not returned |
| Index | In memory. Built on open from one query over all current descriptions and aliases; updated after every write the space makes |
| With `at` | The index is not used: the entities valid at that instant are read with `valid_at` and ranked the same way |
| Result | `MemoryItem` per entity with `ref`, `kind`, `text`, `attributes`, `validFrom`, `validTo` and `score`, best first, at most `limit` |

The index covers current facts only, so a fact with a future `valid_from` enters it when the space is next opened or written to after that instant; recall re-checks validity of its hits against the clock before returning them.

## 5 Configuration

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `profile` | `engineering` \| `personal` | - | The schema profile. Required |
| `root` | path | - | Directory of the spaces: the graph of space `s` is `<root>/<s>/<fileName>` |
| `fileName` | string | `memory.graph` | Graph file name inside a space directory. Homunculus sets `temporal.graph`, the name its spaces have today |
| `file` | path | - | One fixed graph file instead of `root`; the space name is then a label only. Used by the line server |
| `extraction.maxTokens` | integer | 1024 | Token limit passed to the sampler |
| `extraction.context` | integer | 10 | Number of existing items shown to the extraction prompt |

Exactly one of `root` and `file` is set.

## 6 Extraction

`retain({ exchange })` turns one finished turn into items.

1. Recall the existing items the exchange touches: `recall(exchange, { limit: extraction.context })`.
2. Build the prompt: the profile's extraction guide; the entity kinds and attributes the profile accepts; the current date, time and time zone from `meta`; the existing items with their references, so that a changed statement reuses its reference; the exchange.
3. Call the sampler with the prompt and `extraction.maxTokens`.
4. Parse the answer: a JSON array of items (`ref`, `kind`, `text`, `attributes`, `validFrom`, `validTo`), with a surrounding code fence tolerated. An empty array means nothing durable was said.
5. Store the items as in section 2. Invalid items are rejected one by one.

| Rule | Detail |
| --- | --- |
| Output form | JSON, not a Datalog block: the same validation path as `retain({ items })`, and no parser for model-written Datalog |
| Unparseable answer | Nothing is stored; the result has one `rejected` entry with the reason `extraction output is not a JSON array` and the first 500 characters of the answer |
| Scope | Only what the exchange states. The guide tells the model not to store what the agent suggested and to return `[]` for small talk |
| Sampler | Supplied by the application. Its text is data: it is parsed, never executed and never followed |

## 7 Forget

| Mode | Graph operation | What remains |
| --- | --- | --- |
| `close` | `retract` with mode `close` for every current fact of the entity, at now | The facts are visible at earlier valid times and earlier transactions |
| `erase` | `retract` with mode `correct` for every fact of the entity, at every valid time | The facts are gone from every valid time. An `as_of` before the erase still shows them: MiniGraf keeps transaction history, and the bytes stay in the file |

Erase is therefore logical, not physical. A user's request to forget something is met for every recall and every current or valid-time query; removing the history from the file needs a graph rewrite, which the provider does not offer.

## 8 Homunculus graphs

Homunculus graphs exist today, written by temporal-reasoning 0.9.0 on the same engine. The provider opens them in place if crucible/V-01 holds. It then finds entities without the `ident` system attribute the alchemist binding writes; on open, the provider writes `ident` and the kind's `entity-type` for every entity that has a `description` and lacks them. If crucible/V-01 fails, crucible/P-04 slice 5 exports the facts with temporal-reasoning and imports them through `transact`, keeping the valid-time windows.
