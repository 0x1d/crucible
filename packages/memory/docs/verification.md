---
id: crucible/packages/memory/verification
title: Verification
type: VER
owner: crucible/packages/memory
status: Draft
date: 2026-11-13
depends: [crucible/packages/memory/requirements, crucible/packages/memory/interfaces/memory-api, crucible/packages/memory/interfaces/line-protocol]
related: [crucible/packages/memory/design/minigraf-provider]
planned: []
---

# Verification

**Planned** crucible/P-04

The package is verified by the provider conformance suite, run against the in-memory provider and against the minigraf provider with both profiles; by the fact-operation tests that move from `projects/alchemist/core/minigraf-memory.test.ts`; by tests of recall, extraction and the line server; and by the consumers' own suites. Nothing is built yet: every row has the status `not built` and names the test that will prove it.

## 1 Strategy

| Level | Tool | Command | Runs in |
| --- | --- | --- | --- |
| Unit | `node:test` | `pnpm test` in `packages/memory` | CI |
| Conformance | `providerConformance` per provider and profile | `pnpm test` in `packages/memory` | CI |
| Integration | Line server as a subprocess; `mix test` with `Runtime.Memory` | `pnpm test` in `packages/memory`; `mix test` in `projects/alchemist/runtime` | CI |
| Consumers | Homunculus server tests with a scripted sampler | `pnpm test` in `projects/homunculus/server` | CI |
| Manual | Homunculus server with a device or the simulator | Section 3 | Before the switch of crucible/P-04 slice 5 |

## 2 Traceability

| Requirement | Method | Check | Status |
| --- | --- | --- | --- |
| crucible/packages/memory/FR-001 | test | `src/testing/in-memory.test.ts::conformance: in-memory provider` | not built |
| crucible/packages/memory/FR-002 | test | `src/registry.test.ts::returns the minigraf provider by id`, `::unknown id is rejected` | not built |
| crucible/packages/memory/FR-003 | test | `src/minigraf/recall.test.ts::ranks the matching entity first`, `::matches an alias in the personal profile` | not built |
| crucible/packages/memory/FR-004 | test | `src/minigraf/recall.test.ts::at returns the items valid at that instant` | not built |
| crucible/packages/memory/FR-005 | test | `src/minigraf/retain.test.ts::stores valid items and rejects invalid ones with a reason` | not built |
| crucible/packages/memory/FR-006 | test | `src/minigraf/extraction.test.ts::stores the items a scripted sampler returns` | not built |
| crucible/packages/memory/FR-007 | test | `src/minigraf/extraction.test.ts::exchange without a sampler is rejected` | not built |
| crucible/packages/memory/FR-008 | test | `src/minigraf/retain.test.ts::a changed description closes the old fact and keeps its history` | not built |
| crucible/packages/memory/FR-009 | test | `src/queue.test.ts::overlapping retain calls finish in call order` | not built |
| crucible/packages/memory/FR-010 | test | `src/minigraf/forget.test.ts::close keeps history`, `::erase removes every valid time` | not built |
| crucible/packages/memory/FR-011 | test | `src/minigraf/tools.test.ts::four tools with schemas`, `src/testing/in-memory.test.ts::no tools` | not built |
| crucible/packages/memory/FR-012 | test | `src/minigraf/provider.test.ts::one file per space`, `::second open of a space fails` | not built |
| crucible/packages/memory/FR-013 | test | `src/minigraf/profiles.test.ts::engineering rejects alias`, `::personal accepts alias and tags, rejects edges` | not built |
| crucible/packages/memory/FR-014 | test | `src/minigraf/facts.test.ts` (moved from `projects/alchemist/core/minigraf-memory.test.ts`) | not built |
| crucible/packages/memory/FR-015 | test | `src/line-server.test.ts::ready, request, close`; `mix test` in `projects/alchemist/runtime` | not built |
| crucible/packages/memory/FR-016 | test | `src/line-server.test.ts::recall and forget lines` | not built |
| crucible/packages/memory/OR-001 | analysis | `bench/recall.bench.ts`: p95 of 1,000 queries on a generated graph of 5,000 entities | not built |
| crucible/packages/memory/OR-002 | analysis | `bench/recall.bench.ts`: open time of the same graph | not built |
| crucible/packages/memory/OR-003 | inspection | `package.json` dependencies; no import path containing `projects/` | not built |
| crucible/packages/memory/OR-004 | test | `src/minigraf/extraction.test.ts::prose from the sampler stores nothing` | not built |
| crucible/packages/memory/OR-005 | inspection | CI runs the package tests on Node 24 on Linux | not built |
| crucible/packages/memory/CF-01 to crucible/packages/memory/CF-10 | test | `providerConformance`, run in `src/testing/in-memory.test.ts`, `src/minigraf/conformance.test.ts` (profiles `engineering` and `personal`) | not built |

## 3 Manual procedures

### 3.1 Recall quality before the homunculus switch (crucible/packages/memory/G-04)

1. Take a copy of a homunculus memory space that has been in use.
2. For 20 questions about stored facts, record the memory context the current server produces (`memory_prepare_turn`).
3. Open the copy with the minigraf provider, profile `personal`, and run `recall` with the same questions.

**Expected:** for every question, the fact that answers it is among the recalled items whenever it was in the current server's context.

### 3.2 Homunculus without the Python child (crucible/packages/memory/G-04)

1. Start the homunculus server in an environment without `uvx` on `PATH`.
2. Tell the assistant a fact about yourself; end the session.
3. In a new session, ask for that fact.
4. Say that the fact changed; ask again; ask what it was before.

**Expected:** the fact is recalled in step 3, the new value in step 4, and the old value is found through `memory_query` with an earlier `valid_at`.

### 3.3 Existing graph (crucible/V-01)

1. Open a graph written by temporal-reasoning 0.9.0 with the provider.
2. Run `memory_overview` and a `memory_query` for one known entity.

**Expected:** the entities and their descriptions are listed; if the open fails, the migration of [crucible/packages/memory/design/minigraf-provider](design/minigraf-provider.md) section 8 applies.
