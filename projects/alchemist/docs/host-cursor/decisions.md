---
id: crucible/alchemist/host-cursor/decisions
title: Decisions
type: AD
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-13
related: [crucible/alchemist/host-cursor/design]
---

# Decisions

| Id | Decision | Rationale | Alternatives considered | Status |
| --- | --- | --- | --- | --- |
| AD-01 | The agent gets only the MCP tools, and each session workspace under `hosts/cursor/.sessions/` is its own git root | No native tools bypass the codex; the repository's `AGENTS.md`, ambient MCP servers and user skills stay out of the prompt | Native tools beside the codex | Decided |
| AD-02 | The model writes `handoff.md` with a server tool; the TUI adapter does the fork | The model knows the working set; only the adapter holds the continuation token and can leave the store. The SDK has no call that replaces a store's history | Summary written into the current store; fork chosen by the model | Decided |
| AD-03 | Fork automatically only when the last prompt is over `maxContextTokens` (default 200,000); below it, only on a compact ask | The footer turns red above 200,000; yellow (150,000-200,000) still works without a fork | Forking from yellow | Decided |
| AD-04 | The handoff file is rendered from a closed set of fields and capped at 12,000 bytes | Keeps the seed short and predictable; the measured handoff was 802 bytes | A free-text summary field | Decided |
| AD-05 | `pinnedModel` is off by default; when on, it pins `composer-2.5` at `reasoning_effort: high` without `fast` | With `auto`, a follow-up read 512 cached tokens of a 6,816-token prompt; with the pin, 6,592 of 6,575. The pin changes the product's model, so operators turn it on | `grok-4.7` with `fast` as the default model (the first proposal) | Decided |
| AD-06 | A follow-up carries no model; the model is fixed when the serve host starts | A model change misses the cached prefix; the SDK accepts no model on a live `POST /v1/session` | Per-turn model changes | Decided |
| AD-07 | History reclaim is one exclusive mode per host: the SDK's own compaction first, the handoff fork as the portable fallback | Running an SDK compaction and a fork together duplicates work; the handoff works on every host path and when the SDK path fails | Both at once; handoff only | Decided |
| AD-08 | Large codex tool results are digested when emitted (`resultDigest`, on by default) | The Cursor HTTP session path has no hook that rewrites a tool result before it enters the store. A `call_function` result of 144,150 bytes became 1,782; a 142 KB read turn went from 59,900 to 21,500 input tokens | Rewriting results in an SDK hook (used where the SDK has one) | Decided |
| AD-09 | `defaultMaxBytes` is on by default | A second guard when the digest is off: the read payload fell from 144,150 to 66,609 bytes; with the digest on it changes nothing measurable | Off by default (the earlier choice, revised once all four tools were digested) | Decided |
| AD-10 | Each `context-size` budget sits between the measured size with the lever and without it, and a new always-on line is kept only when `named-read` still passes | Named read 25,743 against 62,802 for search-before-read; 142 KB read 21,556 against 119,237 uncapped; docker summary 14,728 against a 17,490 listing; array digest 14,256 against 17,848 inlined. One always-on line naming `docker.overview` added 112 tokens to every turn and was removed | Fixed budgets without measurement | Decided |
| AD-11 | All four codex tools go through `capToolResult` | Results of `find_function` with `detail: true` and of `define_function` and `load_function` entered the store whole while only `call_function` was digested | Digesting `call_function` only | Decided |
| AD-12 | `git.log` defaults to 8 commits without `--numstat` | Full numstat over 20 commits was the main source of the 188,000-token status turn | A separate `git.log_oneline` entry | Decided |
| AD-13 | Exploration is a codex entry with fixed profiles, and its gate is in the host's `call_function` | Fixed profiles keep the result size predictable; a host-side gate fails fast without a runtime round trip | Model-chosen step lists; a gate in the runtime | Decided |
| AD-14 | Auto retain sends the `/remember` prompt; the host never writes memory itself | The model decides what is durable, as with a manual `/remember` | Silent `memory.remember` calls from the host | Decided |
| AD-15 | Design documents describe what is built; investigations and measurements are kept as decision rationale and as eval fixtures, not as design sub-documents | Formulary's writing rules: descriptive, no journals or progress logs | Keeping the dated plans | Decided |
