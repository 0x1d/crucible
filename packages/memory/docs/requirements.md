---
id: crucible/packages/memory/requirements
title: Requirements
type: REQ
owner: crucible/packages/memory
status: Draft
date: 2026-11-13
depends: [crucible/requirements, crucible/architecture/shared-packages, crucible/decisions]
related: [crucible/increments/repository-and-migration, crucible/alchemist/runtime/design/memory, crucible/homunculus/server/design]
planned: []
---

# Requirements

**Planned** crucible/P-04

The memory package defines what an application may ask of a memory - recall, retain, forget, provider tools, a prompt section - without saying how the memory stores anything, and it ships minigraf as the first provider. Alchemist and homunculus use the same provider code with different schema profiles and separate graphs. The requirements keep the two apart: the generic interface must fit a provider that has no fact graph, and the minigraf provider must keep what both applications rely on today.

## 1 Purpose

Alchemist and homunculus both store agent memory in a minigraf graph, through two implementations: a native Node binding in alchemist, a Python MCP child in homunculus. The package replaces both with one (crucible/AD-10) and puts it behind an interface that another memory layer can implement later (crucible/AD-03).

## 2 Scope

| In scope | Out of scope |
| --- | --- |
| The memory interface: provider, space, items, results | The agent session that calls it before and after a turn: the applications today, `packages/agent` with crucible/P-05 |
| The minigraf provider with the profiles `engineering` and `personal` | A second provider (Hindsight, crucible/V-02) |
| Native recall and extraction of facts from an exchange | The model call that answers the extraction prompt: injected by the application |
| The line server for non-TypeScript consumers | The codex entries `memory.*` and `Runtime.Memory`: crucible/alchemist/runtime |
| A conformance suite every provider passes | The homunculus wiki (crucible/AD-26) |
| | Sharing a graph between applications (crucible/AD-05) |

## 3 Users and actors

| Actor | Kind | Goal |
| --- | --- | --- |
| Homunculus server | component | Recall facts about the user before a voice turn, store what the user said after it, one memory per memory space |
| Alchemist runtime | component | Serve the `memory.*` codex entries from one engineering graph |
| Agent | external system | Query and change memory through the provider tools, guided by the prompt section |
| Application operator | person | Choose the provider, the profile and where the graph lives, in configuration |
| Provider author | person | Add a provider without changing the applications |

## 4 Goals

| Id | Goal |
| --- | --- |
| G-01 | One memory implementation for alchemist and homunculus (crucible/requirements section 4) |
| G-02 | The provider can be replaced without changing application code (crucible/AD-03) |
| G-03 | Each application owns its graph; no memory content is shared (crucible/AD-05) |
| G-04 | No behaviour change for alchemist; homunculus keeps its memory behaviour without the Python child |
| G-05 | Nothing on a voice turn waits for extraction (crucible/C-04) |

## 5 Functional requirements

| Id | Requirement | Acceptance | Priority | Goal |
| --- | --- | --- | --- | --- |
| FR-001 | The package shall expose memory through `recall`, `retain`, `forget`, `tools`, `promptSection` and `close` on a memory space, with no operation that names a fact, a triple or a query language. | The conformance suite passes for the in-memory provider, which stores text only | must | crucible/packages/memory/G-02 |
| FR-002 | When an application opens a provider by its configured id, the package shall return that provider without the application importing provider code. | `createMemoryProvider({ provider: "minigraf", ... })` returns a provider whose `id` is `minigraf`; an unknown id fails with `unknown memory provider` | must | crucible/packages/memory/G-02 |
| FR-003 | When `recall` is called with a query, the space shall return the items most relevant to it, best first, at most `limit`. | After retaining three items, a query naming a word of one returns that item first | must | crucible/packages/memory/G-01 |
| FR-004 | When `recall` is called with `at`, a provider with the `temporal` capability shall return the items as they were valid at that instant. | An item closed yesterday is returned for `at` two days ago and not for now | must | crucible/packages/memory/G-01 |
| FR-005 | When `retain` is called with items, the space shall store them and return what was stored and what was rejected, each rejected item with a reason. | One valid and one invalid item: `stored` has one entry, `rejected` has one with its reason | must | crucible/packages/memory/G-01 |
| FR-006 | When `retain` is called with an exchange and the space was opened with a sampler, the space shall extract the durable statements of the exchange through the sampler and store them. | With a scripted sampler, `retain({ exchange })` stores the scripted items | must | crucible/packages/memory/G-04 |
| FR-007 | If `retain` is called with an exchange and no sampler was given, then the space shall reject the call with `extraction is not available`. | The call rejects; `capabilities().extraction` is `false` | must | crucible/packages/memory/G-02 |
| FR-008 | When `retain` stores a statement that replaces a current one about the same subject, the space shall end the old statement and keep its history where the provider is temporal. | Retaining a changed preference: `recall` returns the new text; `recall` with an earlier `at` returns the old | must | crucible/packages/memory/G-04 |
| FR-009 | The space shall run `retain` calls one at a time, in the order they were made. | Two overlapping `retain` calls on one subject end in the state of the second | must | crucible/packages/memory/G-05 |
| FR-010 | When `forget` is called with a reference and `close`, the space shall end the item's validity now; with `erase`, it shall remove the item from every valid time. | After `close`, `recall` does not return it but `recall` with an earlier `at` does; after `erase`, neither does | must | crucible/packages/memory/G-01 |
| FR-011 | The space shall return the provider's agent tools and prompt section, and the application shall need no knowledge of their content. | `tools()` of the minigraf provider returns the four memory tools; of the in-memory provider, none | must | crucible/packages/memory/G-02 |
| FR-012 | The minigraf provider shall open one graph file per space and hold the only open handle to it in the process. | A second `open` of the same space in one process fails with `memory space is already open` | must | crucible/packages/memory/G-03 |
| FR-013 | The minigraf provider shall apply the schema profile it was configured with: entity kinds, attributes, edges, tags, prompt section and extraction guide. | Profile `engineering` rejects `alias`; profile `personal` accepts `alias` and rejects `depends-on` | must | crucible/packages/memory/G-01 |
| FR-014 | The minigraf provider shall accept and reject fact writes, retractions, queries and overviews exactly as alchemist's memory does today. | The tests of `core/minigraf-memory.test.ts` pass against the provider with profile `engineering` | must | crucible/packages/memory/G-04 |
| FR-015 | The package shall provide a line server that opens one graph and serves the provider operations over stdio as line-delimited JSON. | `Runtime.Memory` starts it and `mix test` passes in `projects/alchemist/runtime` | must | crucible/packages/memory/G-04 |
| FR-016 | When the line server receives `recall` or `forget`, it shall run the generic operation on the open graph. | A `recall` line returns items for a retained fact | could | crucible/packages/memory/G-01 |

## 6 Operational requirements

| Id | Quality | Requirement | Measure |
| --- | --- | --- | --- |
| OR-001 | latency | `recall` without `at` returns within 20 ms p95 for a graph of 5,000 current entities | Benchmark on the CI runner with a generated graph |
| OR-002 | latency | Opening a graph of 5,000 current entities, including building the recall index, takes at most 2 s | Same benchmark |
| OR-003 | dependencies | The package depends on Node built-ins, `minigraf` and `zod` only, has no LLM or agent SDK dependency, and imports nothing from `projects/` | Inspection of `package.json` and the import graph |
| OR-004 | robustness | A failed or unparseable extraction stores nothing and leaves the graph as it was | Test with a sampler that returns prose |
| OR-005 | portability | Runs on Node >= 24 on Linux and macOS, with TypeScript sources loaded directly | CI on Linux; manual on macOS |

## 7 Constraints

| Constraint | Source |
| --- | --- |
| A minigraf graph file has exactly one open handle | crucible/C-02 |
| The generic interface is `recall` / `retain` / `forget` plus provider tools and prompt section | crucible/AD-09 |
| Alchemist's native minigraf code is the base of the provider; homunculus uses the same provider | crucible/AD-10 |
| Schema differences are profiles; the attribute sets stay as they are today | crucible/AD-11, crucible/AD-28 |
| Item and result shapes | crucible/AD-27 |
| Package name `@crucible/memory`, in the monorepo | crucible/AD-08, crucible/AD-25 |
| Node, never Bun | crucible/C-03 |

## 8 Assumptions

- Graph files written by temporal-reasoning 0.9.0 are readable by the `minigraf` npm binding 2.0.11 (crucible/V-01). If not, crucible/P-04 slice 5 migrates them.
- Lexical retrieval over descriptions, aliases and ids is as good for homunculus as the retrieval of temporal-reasoning, which is lexical as well. crucible/packages/memory/verification section 3.1 compares the two before the switch.
- A provider such as Hindsight fits the interface without changes (crucible/V-02).

## 9 Terminology

| Term | Meaning |
| --- | --- |
| Provider | An implementation of the memory interface on one storage technology |
| Space | One memory, opened by name: for the minigraf provider one graph file. Homunculus has one per memory space of its configuration, alchemist has one |
| Item | One remembered statement: text, with an optional reference, kind, attributes and validity window |
| Exchange | The text of one finished turn: what the user said and what the agent answered |
| Extraction | Turning an exchange into items with a model call |
| Sampler | The function the application supplies to answer an extraction prompt with model text |
| Profile | The schema of a minigraf graph: entity kinds, attributes, edges, tags, prompt section, extraction guide |
