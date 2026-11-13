---
id: crucible/alchemist/host-cursor/design/context-growth
title: Context Growth
type: DES
owner: crucible/alchemist/host-cursor
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/host-cursor/design]
related: []
planned: []
---

# Context Growth

Session investigation of high prompt size (~181k / 200k) on the Cursor Agent SDK host, whether autocompaction exists, and how to improve it.
A later check sent one read instruction to the IDE, the TUI, and the playground.
Those three meters are compared under [Same instruction, three meters](#same-instruction-three-meters).

## Verdict

**This Cursor host does not autocompact conversation context.**

Follow-ups send only the new user message plus a `continuationToken`. The server-side agent store keeps the full transcript (including tool results). That history is re-presented on later turns (often as cache-read tokens). There is no host- or SDK-level summarization step that shrinks the model prompt.

MiniGraf / memory-journal "compact" is WAL checkpointing for durable facts, not chat compaction. The session memory hook truncates stored journal text for *disk* storage; it does not remove tool payloads from the live prompt.

## Evidence checked

| Area | Finding |
| --- | --- |
| `hosts/cursor/bot/agent.ts` | `defineAgent({ model: "auto", tools: ["mcp"], local: { cwd: ".sessions" } })` - no compact / history-budget options |
| `hosts/cursor/bot/` tools, hooks, instructions | No compaction, prune, or summarization of prior turns |
| `@grok/agent-sdk` (v0.5.0) | No `autocompact` / conversation-summarize API used by this host; `defineAgent` config has no max-context knob |
| Repo-wide search | Zero hits for `autocompact` / auto-compact of chat; "Slim mode" only applies to `find_function` metadata |
| `tui/adapters/cursor.ts` | `CURSOR_CONTEXT_WINDOW = 200_000` (fixed; model `auto` reports no window). Comment notes ~189k cached turns already observed |
| `docs/guides/tui.md` | Context footer: muted &lt;60%, warning 60-85%, error &gt;85%. ~181k ~ **90%** |
| Follow-up protocol | `POST` body is `{ continuationToken, message }` - transcript is not resent by the client; the agent store resumes |

## Why a short Restate/Docker session reached ~181k

**Fixed base (every turn)**

- Large served-agent prompt (`hosts/cursor/bot/instructions.md` ~10kB) plus host/system wrappers and safety rules
- MCP tool schemas for the four codex tools (`find_function`, `define_function`, `load_function`, `call_function`)

**Session-specific growth (retained in the agent store)**

- Full `docker.ps` for 38 containers (normalized maps)
- Multi-container `docker inspect` dumps (env, mounts, labels, networks)
- Entire README and Compose files from `durex-comparison` / `restate/`
- Restate admin `/deployments` JSON (~11kB+ of service metadata)
- Repeated `find_function` / schema discovery turns

`docker.ps_report` and `docker.overview` return counts by state, Compose project, and image, plus published ports.
They do not return the container list.

Codex already has optional caps (`fs.read` / `http.get` `max_bytes`, `fs.rg` `max_matches`, `find` slim mode), but they are opt-in and unused by default for `sys.cmd` stdout and most `call_function` results.

## Same instruction, three meters

Prompt: `read  docs/internal/plans/2026-11-03-cursor-host-context.md`.
The `fs.read` result was 6,159 characters.
The three meters disagree because each surface builds a different prompt.

| Surface | Source | Input tokens | Cached prefix | New this turn |
| --- | --- | --- | --- | --- |
| IDE chat | UI meter | ~33k | not logged | - |
| Playground | `ses_c9efc8ff65e58501bdb33ba7` | 57,371 (UI ~54k) | 32,384 | 24,987 |
| TUI | `ses_19f3eea714496e6705cfafd7` | 90,136 | 80,896 | 9,240 |

Both host sessions were new.
Both used model `default`.
Each workspace was an empty git root at `hosts/cursor/.sessions/<id>/`.
Neither loaded this repository's `AGENTS.md`.

Usage is the `turn.completed` record (`inputTokens` already includes the cache when input is larger than the cache buckets).
`contextTokens()` in `tui/adapters/cursor.ts` reports that input total.
The TUI footer showed 90k.
The playground UI showed about 54k for the turn whose log says 57,371.

### IDE (~33k)

The IDE chat is a different harness.
It opens the path with native Read, once.
It does not also carry `hosts/cursor/bot/instructions.md` or the four codex MCP schemas.
The IDE compacts its own transcript.
~33k matches the playground's cached prefix (32,384), the Cursor harness plus a short tool list.

### Playground (~57k)

`agent-sdk dev` runs with dev mode on.
`resolveServeWorkspaceScanCacheTtlMs` in `@grok/agent-sdk` then leaves the workspace-scan cache at the SDK default of 20 seconds.
The served prompt adds `instructions.md` (~10 KB) and the four codex tools on top of the harness.
The relative read failed.
The model searched with `find_function` and `fs.glob` before an absolute `fs.read`.
Those results stay in the prompt.
About 25k of this turn was uncached.
A dev server rescans often, so the prefix does not stay identical in the cache.

### TUI (90k)

The TUI calls `serve()` with `playground: false` and does not set `dev: true` (`tui/adapters/cursor.ts`).
`setDevMode` stays false.
`@grok/agent-sdk` 0.5.0 defines `SERVE_WORKSPACE_SCAN_CACHE_TTL_MS` (24 hours) and `resolveServeWorkspaceScanCacheTtlMs`, and nothing in the package calls them.
`Cursor.configure({ local: { workspaceScanCacheTtlMs } })` does not run.
The Cursor SDK reads `CURSOR_RIPWALK_CACHE_TTL_MS` and otherwise keeps a 20 second ripwalk cache.
A non-dev TUI process and a dev playground process share that default unless the environment sets the variable.
The cached prefix on this turn was 80,896, about 50k larger than the playground prefix.
Extra discovery (`fs.rg`, `fs.list`, `find_function` with `detail: true`) is real and small.
The file plus the failed lookups are the 9,240 tokens that were not cached.

User skills are not in that prefix.
`RunnerTurnRequest.settingSources` defaults to `["project"]` (`sdk-runner.js`: `request.settingSources ?? ["project"]`).
The Cursor SDK maps `"user"` to `includeUserExtensibility` and managed `~/.cursor/skills-cursor` to `includeManagedSkills`.
Both are false for `["project"]`.
The skills service still walks `~/.cursor/skills` and `~/.cursor/skills-cursor`, then drops any file whose real path is outside the allowed roots.
An empty session git root allows only that directory.
`defineAgent` does not expose `settingSources`, so this host has no switch to turn the user layer on.
On disk, `~/.cursor/skills` is 152 KB and `~/.cursor/skills-cursor` is 432 KB.
That size does not enter the prompt while the user layer stays off.
The Cursor IDE does walk `~/.cursor/skills` and inlines skills installed with `alwaysApply: true`.
That path is the IDE chat, not this host.

### What items 1-6 do to this gap

Items 1-3 (result caps, overview entries, write-large/read-small) target the Restate dumps that grew a later turn toward 181k.
This read never returned a dump, so they leave 33k vs 57k vs 90k where they are.
Item 4 (shorter `instructions.md`) is a few thousand tokens on both hosts.
Item 5 (a handoff file) does nothing on the first message.
Item 6 trims extra `detail: true` lookups, a few thousand tokens.

## Suggested improvements

Ordered by leverage.
Items 1-7 target transcript growth toward the 200k window.
Items 8-10 target the same-prompt gap between the IDE, the playground, and the TUI.

### 1. Bridge-level tool-result cap (host / MCP adapter)

Truncate or summarize `call_function` / `sys.cmd` / large MCP outputs **before** they enter the agent transcript.

- Default byte/char cap with `truncated: true`
- Persist full payload under the session workspace; return path + head/tail + counts to the model
- Apply even when the Elixir entry forgets `max_bytes`

### 2. Domain "overview" entries (codex)

Prefer short reports over raw dumps:

- `docker.overview` - counts by compose project / image, notable published ports
- `restate.status` - `restatectl status` + node/port summary (not full `/deployments`)
- Teach `instructions.md` to call these first; use raw inspect/API only when drilling in

`docker.ps_report` should actually summarize (group by project/image), not stamp a timestamp on the full list.

### 3. Write-large / read-small convention

For inspect, compose, and admin API pulls:

1. Write artifact to `.sessions/<id>/artifacts/` (or similar)
2. Return `{ path, bytes, summary }`
3. Let the model `fs.read` / `fs.rg` with `max_bytes` / line caps

### 4. Shrink the always-on prompt

- Move long Memory protocol examples out of `instructions.md` into `codex.docs` / docs (load on demand)
- Keep a short "when to use which memory slug" table in the prompt
- Avoid duplicating safety/system material that the harness already injects

### 5. Same-session handoff (operational, available today)

The host still has no compaction API.
`/new` creates another agent store and drops the continuation token, so the next turn cannot see this conversation.
Keep the same session.

When the context footer is high, write the working set to a file and remember only the path:

1. Write `handoff.md` in the session workspace (`.sessions/<id>/handoff.md`).
   Record touched files and systems, pitfalls, the current state of the work, next steps, and any other fact required to continue.
2. `memory.remember` the path and a one-line description.
   Leave the summary body out of the graph.
   A fact's attributes are the closed set in `instructions.md` (`description`, `rationale`, and the edges). Put the path in `description`.
3. Later turns of this session call `fs.read` on that path.
   A later session loads the path from memory and reads the same file.

The continuation token still replays prior tool results.
The file is the compact working set.
It does not shrink the live prompt.
Shrinking the prompt on the same session needs a host API that replaces history with that file. This SDK does not have one.
The current contract is the [context handoff design](context-handoff.md).
The TUI adapter forks into a new store. `memory.remember` is not the seed.

### 6. Agent / instruction policy

- Default `max_bytes` on `http.get` and large `fs.read`
- Avoid `find_function` with `detail: true` unless editing that entry
- Avoid full `docker inspect` env dumps; format a small label/port/workdir extract
- Prefer one orchestration entry over many fat `call_function` chains that each leave a large result in history

### 7. Observability

- Surface per-turn prompt size (TUI already approximates this) in playground/HTTP channels
- Log largest tool-result sizes so regressions in "chatty" entries are visible
- Alert or soft-prompt the user at 60% / 85% to write `handoff.md` and remember its path

### 8. Re-measure the TUI prefix

The 90k vs 57k gap on one fresh read is a cached prefix (80,896 vs 32,384), not the file.

A later probe sent the same line through `agent-sdk run` (playground off, dev off), with `CURSOR_RIPWALK_CACHE_TTL_MS=20000`, a new state root, and a new session (`ses_bfd451099fdd390a79d2f238`).
The session directory was its own git root, as the TUI and playground sessions were.
Usage was input 34,253, cache read 18,304, cache write 0.
The turn did not read the file: `elixir` was not on `PATH` (`spawn elixir ENOENT`), so the figure is the prefix plus two failed tool calls.
34k matches the IDE meter and the playground's cached prefix.
It does not match the TUI's 80,896 cached prefix.
A short TTL on a new process does not reproduce 90k.
The skills loader logged `ruleCount: 34` and `skillCount: 23` before the path filter (`servedFromCache: false`).
The prompt size shows those home-directory bodies were not kept.

The 24 hour constant in `sdk-runner.js` is unused in this package, so it does not explain the original gap.
What remains is a prefix-byte difference between the TUI session and the playground session.
The next measurement is a TUI restart that can run `elixir`, then the same one-line read, with input, cache read, and cache write recorded from `turn.completed`.

### 9. Read a named path in one call

When the user names a file path, call `fs.read` once with the repository root.
Skip `find_function`, `fs.glob`, and `fs.rg` unless that read fails.
Both host turns spent the uncached tail on a failed relative path and then a search.
Put that rule in `instructions.md`.

### 10. Split cached and new in the footer

Show cached prefix and new tokens separately.
This TUI turn was 80,896 reused plus 9,240 new.
A single 90k figure reads as fresh context.
Log the same pair on playground and HTTP turns (extends item 7).

## Measurements (2026-11-03)

The gate is `hosts/cursor/evals/context-size.eval.ts`.
A named repo read must stay at or under **32,000** input tokens, with one `fs.read` and no `find_function`.
A 142 KB read must stay at or under **24,000** input tokens, and the tool result must be a string digest with `truncated: true`.
A `docker.ps_report` summary must stay at or under **16,500** input tokens, with one call and no container list.
A `docker.ps` listing must stay at or under **16,500** input tokens, and the tool result must be an array digest whose sample is shorter than the array.
A `find_function` search for `memory` (no `detail`) must stay at or under **28,000** input tokens, with slim hits that include run/1 `@spec` lines and no per-hit moduledoc.
32,000 sits above the shrunk-prompt measurement (25,743) and below the search turn (62,802).
24,000 sits above the string digest (21,556) and below the uncapped read (119,237).
16,500 sits above the summary (14,728) and below the `docker.ps_report` listing (17,490).
The same 16,500 sits above the array digest (14,256) and below the inlined `docker.ps` listing (17,848).

| Step | Case | Input | Cache read | New | Tools | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Before changes | named read | 62,802 | 47,360 | 15,442 | 8 | fail |
| Named path is one `fs.read` (`../` from `runtime/`) | named read | 29,426 | 18,048 | 11,378 | 1 | pass |
| Memory JSON examples moved to `bot/skills/memory.md` | named read | 27,311 | 16,640 | 10,671 | 1 | pass |
| `call_function` cap at 32,768 chars | named read | 27,556 | 15,872 | 11,684 | 1 | pass |
| Before the cap | 142 KB read | 119,237 | 85,248 | 33,989 | 12 | fail |
| After the cap | 142 KB read | 24,520 | 8,576 | 15,944 | 1 | pass |
| Fresh baseline, same tree | named read | 28,016 | 9,472 | 18,544 | 1 | pass |
| Fresh baseline, same tree | 142 KB read | 24,412 | 16,640 | 7,772 | 1 | pass |
| Authoring sections moved to `bot/skills/codex.md`; memory rules shortened | named read | 25,743 | 15,360 | 10,383 | 1 | pass |
| Same prompt shrink | 142 KB read | 22,317 | 9,344 | 12,973 | 1 | pass |
| Result slice cut to 400 + 200 characters | named read | 25,699 | 15,232 | 10,467 | 1 | pass |
| Same smaller slice | 142 KB read | 21,334 | 16,128 | 5,206 | 1 | pass |
| `docker.ps_report` full listing (9,778 bytes) | docker report | 17,490 | 9,728 | 7,762 | 1 | - |
| `docker.ps_report` summary (1,605 bytes) | docker report | 14,728 | 9,728 | 5,000 | 1 | pass |
| One always-on line pointing at `docker.overview` | named read | 25,811 | 15,360 | 10,451 | 1 | reverted |
| `docker.ps` inlined (10,720 bytes, 45 containers) | structured list | 17,848 | 9,728 | 8,120 | 1 | - |
| Harness digest of that array | structured list | 14,256 | 7,296 | 6,960 | 1 | pass |
| Document body left inline | named read | 26,270 | 8,960 | 17,310 | 1 | pass |
| 142 KB string digest | 142 KB read | 21,556 | 8,064 | 13,492 | 1 | pass |
| `docker.ps_report` still inline | docker report | 14,620 | 9,088 | 5,532 | 1 | pass |
| Named read of this file after the rows above | named read | 26,720 | 16,896 | 9,824 | 1 | pass |

The named-read file is a single document body under 32,768 characters, so the digest leaves it inline.
The 142 KB body is written under the session `artifacts/` directory.
The model sees a string digest plus `head`, `tail`, `bytes`, and `path`.
Head is the first 400 characters of the file and tail is the last 200.
The same slices are repeated on the string node.
A bulky array below 32,768 characters is replaced with its length, its field names, and two samples.
The original JSON is still stored next to that digest.
The inlined `docker.ps` listing was 17,848 input tokens.
The array digest was 14,256.
16,500 sits between those two figures.

An always-on line naming `docker.overview` raised the named read from 25,699 to 25,811, so that line was removed.
The summary entry still exists. The eval names `docker.ps_report` in the user message.
These were not applied after that: a default `max_bytes` on `fs.read` and `http.get`, a handoff section in the always-on prompt, a cached/new split in the footer, and playground prompt logging.
A default `max_bytes` under the host cap would replace the short slice with a larger body.
A handoff section and the footer do not shrink this turn's prompt.
`restate.status` was not added. This machine has no Restate CLI.
A confirmation run after this table was extended measured named read 26,283, the 142 KB read 21,275, and the docker summary 14,678.
All three passed their budgets. The memory eval passed on the shortened schema.
That confirmation was before the array digest.
The digest batch is the five rows from the inlined `docker.ps` listing through `docker.ps_report` still inline.
A named read of this file after those rows measured 26,720 and stayed inline.

## Non-goals / clarifications

- Cursor **IDE** chat may have its own summarization; that does not apply to this **Agent SDK** host path. The IDE meter is also a different prompt (native Read, no served `instructions.md`).
- Prompt-cache double-counting was already corrected in `contextTokens()` (input often already includes cache buckets). High reported ctx is real prompt size, not a pure accounting bug.
- Memory graph growth is separate from transcript growth; remembering Restate facts does not remove prior tool blobs from the session store.

## Related paths

- Host adapter: `hosts/cursor/bot/`
- TUI serve options (dev off): `tui/adapters/cursor.ts`
- Workspace-scan TTL: `@grok/agent-sdk` `dist/internal/sdk-runner.js` defines `SERVE_WORKSPACE_SCAN_CACHE_TTL_MS` and `resolveServeWorkspaceScanCacheTtlMs` and does not call them. The Cursor SDK (`dist/cjs/336.js`) reads `CURSOR_RIPWALK_CACHE_TTL_MS`, default 20 seconds.
- Settings layers: `sdk-runner.js` `settingSources: request.settingSources ?? ["project"]`. `"user"` is off.
- Probe: `ses_bfd451099fdd390a79d2f238` (short TTL, `agent-sdk run`, input 34,253 / cache read 18,304)
- Context accounting: `tui/adapters/cursor.ts`, `docs/guides/tui.md`
- Compared sessions: `hosts/cursor/.agent-serve/sessions/ses_19f3eea714496e6705cfafd7` (TUI), `hosts/cursor/.agent-serve/cursor/sessions/ses_c9efc8ff65e58501bdb33ba7` (playground)
- Slim find: `docs/reference/protocol.md`
- Example noisy tools: `functions/docker/ps/tool.ex`, `functions/docker/ps_report/tool.ex`, `functions/sys/cmd/tool.ex`, `functions/http/get/tool.ex`
