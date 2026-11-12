---
id: crucible/alchemist/tui/design
title: Design
type: DES
owner: crucible/alchemist/tui
status: Draft
date: 2026-11-11
depends: [crucible/alchemist/architecture]
related: []
planned: []
---

# Design

Status: Implemented for the Claude host and the Cursor host.

## Goal

Add a terminal UI that runs one Alchemist host at a time.
The user selects the host, the session, the model, and the effort level.
The TUI streams replies, reasoning, and tool calls.
The footer shows context use and session cost.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Location | Top-level `tui/` | The TUI imports the hosts. No file under `hosts/` or `core/` imports the TUI. |
| UI library | `@earendil-works/pi-tui` 1.4.0 | Differential rendering, `Editor`, `Markdown`, `SelectList`, overlays, and autocomplete. The user approved this dependency as an exception to the AGENTS.md rule against new dependencies on a first cut. |
| Renderer | `TuiAltScreen` with a `VStack` layout | The editor and the footer stay at the bottom of the screen. The transcript scrolls in a `ScrollView`. On exit, pi-tui restores the main screen and prints the transcript. |
| Host contract | One `HostAdapter` interface with a normalized event stream | Rendering and stats code is the same for both hosts. |
| Claude transport | `query()` with `alchemistOptions()` from `hosts/claude/codex.ts` | Reuses the host as it is. |
| Cursor transport | `serve("hosts/cursor", { mode: "single", port: 0 })` in the TUI process, then the HTTP session API | No child process and no port discovery. One process stays up so the runner can keep the Cursor agent handle. |
| Cursor context window | Fixed at 200,000 tokens | Model `auto` reports no window size. |
| Session index for Claude | `.alchemist/tui/claude-sessions.json` | `listSessions()` for the repository root also returns Claude Code CLI sessions. The index keeps only sessions that the TUI created. |
| Memory checkpoint | A marker line inside the `/remember` prompt | The transcript holds the checkpoint. The TUI keeps no state for it. |
| Theme | One theme, `alchemist`, in a theme registry | Every component reads its styles from the active theme. |
| Script | `pnpm run tui` runs `node tui/main.ts` | Matches `pnpm run chat:claude`. |

## Layout

```text
tui/
  main.ts            start flow, slash commands, key bindings, wiring
  log.ts             console redirect to the log file
  commands.ts        slash command list and parser
  view.ts            transcript components and footer
  stats.ts           per-session token, context, and cost totals
  changes.ts         git snapshots of functions/ and the /diff output
  remember.ts        /remember prompt template
  theme.ts           Palette, Theme, createTheme(), theme registry
  adapters/
    types.ts         HostAdapter, SessionSummary, HostEvent
    claude.ts
    cursor.ts
  *.test.ts          node:test unit tests
```

## Host adapter contract

```ts
interface HostAdapter {
  readonly name: string;
  readonly sessionId: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  listSessions(): Promise<SessionSummary[]>;
  openSession(id: string | undefined): Promise<HostEvent[]>; // replayed events
  listModels(): Promise<ModelChoice[]>;
  setModel(model: string | undefined, effort: string | undefined): void;
  send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent>;
  close(): Promise<void>;
}
```

`openSession(undefined)` starts a new session.
`send()` stops the turn when the signal aborts.
After a stop, the TUI shows the line `Stopped.`.

### Events

| Event | Fields | Claude source | Cursor source |
| --- | --- | --- | --- |
| `user` | `text` | A stored user message, in a replay only | `message.received`, in a replay only |
| `text` | `delta` | `stream_event` with a text `content_block_delta` | `message.appended` |
| `reasoning` | `delta` | `stream_event` with a `thinking_delta` | `reasoning.appended` |
| `tool` | `id`, `name`, `input` | `tool_use` block in an `assistant` message | `actions.requested` |
| `tool_result` | `id`, `ok`, `output` | `tool_result` block in a `user` message | `action.result` |
| `usage` | `contextTokens`, `contextWindow`, `costUsd` | `result` message | `turn.completed`, then `GET /v1/session/:id/cost` |
| `done` | `sessionId` | `result` with `subtype: "success"` | `turn.completed` |
| `error` | `message` | `result` with an error subtype | `turn.failed` or an HTTP error |

### Claude adapter

- One `query()` in streaming input mode serves the whole session. It gets `alchemistOptions()`, `includePartialMessages: true`, `resume`, `model`, and `effort`.
- `send()` pushes the prompt as an `SDKUserMessage` into the query's input queue and reads messages until the `result` of that turn.
- The CLI process, its MCP connections, and the prompt cache prefix stay the same from turn to turn.
- `openSession()` starts the process right away. Opening a different session, or a new one, closes the old process first.
- A new process that resumes the session starts after a failure, or when a stopped turn sends no `result` within 10 seconds.
- Stopping a turn calls `interrupt()`. The adapter reads on until the turn's `result` and drops its error event.
- A model or effort change goes to the live process through `setModel()` and `applyFlagSettings({ effortLevel })`. If that fails, the next turn starts a new process with the new options.
- `alchemistOptions()` sets `strictMcpConfig: true` and `settings: { disableClaudeAiConnectors: true }`. claude.ai connectors would add tools the model cannot use and change the tool list during the session, which breaks the prompt cache.
- `listModels()` reads `supportedModels()` from the live process, which also gives the effort levels of each model.
- `listSessions()` calls `listSessions({ dir: <repo root> })` and keeps the ids in the session index.
- `openSession(id)` replays `getSessionMessages(id)` as events.
- The adapter writes each new session id to the session index after the first `result` message.

### Cursor adapter

- The adapter starts one in-process server on first use, with state in `hosts/cursor/.agent-serve`, the same directory as `agent-sdk dev --dir hosts/cursor`.
- The server stays up across turns and across session switches. Restarting it would drop the runner's cached agent handle.
- `openSession(undefined)` clears the local session id and defers `POST /v1/session` to the first `send()`. It does not paste a transcript into that request.
- A follow-up calls `POST /v1/session/:id` with the new prompt and the current continuation token. The body has no earlier turns. The server resumes the stored agent, which is what keeps the prompt cache prefix stable.
- `send()` reads `GET /v1/session/:id/stream` from the last index plus 1 until `turn.completed` or `turn.failed`.
- An aborted signal calls `POST /v1/session/:id/stop`. The adapter keeps reading until the terminal event, or for 10 seconds. The server stays up either way.
- A stale continuation token is refreshed from `GET /v1/sessions` and the follow-up is tried once. The prompt is not rewritten into a new session.
- `listSessions()` calls `GET /v1/sessions` and skips task sessions.
- `openSession(id)` replays `GET /v1/session/:id/events?format=json` and stores that session's continuation token.
- `listModels()` returns a fixed list: `auto`, `composer-2.5`, `grok-4.7`. The user can also type a model id.
- Effort maps to the model param `reasoning_effort` (`reasoning` for a gpt id) with the values `low`, `medium`, and `high`. The create body also sends `fast=true`, which the session API requires next to an effort param.
- `modelConfig` is sent only on create. Follow-ups omit it so the frozen model, and the cache prefix, do not change.
- The installed session API accepts `modelConfig` only when `dryRun` is set. A live create that is rejected for that reason is retried without `modelConfig` and runs the model from `hosts/cursor/bot/agent.ts`.
- A model or effort change detaches the open session only after a create has stored `modelConfig`. Until then the open agent stays, and the TUI tells the user that `/new` starts the session that carries the selection.

## Stats

- Context tokens are the prompt size of the last turn. Claude's input, cache-read, and cache-write counters are disjoint, so they are added. Cursor's `inputTokens` already include the cache when input is at least the cache total, and that input total is the prompt size. When Cursor input is smaller than the cache buckets, the counters are disjoint and are added.
- The context window comes from `modelUsage[model].contextWindow` for Claude and is 200,000 for Cursor.
- Session cost for Claude is `total_cost_usd` of the latest `result`. The SDK reports a running total for the session, and a resumed session continues from the total in its transcript.
- Session cost for Cursor is `costUsd` from the cost route for the whole session.
- An opened session starts from the usage in its replayed events.
- If the replay has no cost data, the cost starts at 0 and the footer shows it with a `~` prefix until the first live total arrives.
- A new session, `/new`, `/session`, and `/host` set the stats to the values of the session that opens.

## Start flow and commands

1. Select a host in a `SelectList` overlay.
2. Select a session in a second `SelectList` overlay. "New session" is the first item.
3. The transcript replays the opened session. The editor gets focus.

| Command | Action |
| --- | --- |
| `/host` | Select a host, then a session of that host. |
| `/session` | Select a session of the current host. |
| `/new` | Start a new session on the current host. |
| `/model [id]` | Set the model. Without an id, open the model overlay. |
| `/effort [level]` | Set the effort level. Without a level, open the effort overlay. |
| `/diff` | Show a colored diff of the files under `functions/` that changed in this TUI run. |
| `/remember [instructions]` | Send the memory extraction prompt. |
| `/exit` | Close the adapters and exit. |

| Key | Action |
| --- | --- |
| `Enter` | Send the prompt. |
| `Shift+Enter` | Add a new line. |
| `Up`, `Down` | Move through the prompt history of this TUI run. |
| `Esc` | Stop the turn in progress. |
| `Ctrl+C` | Stop the turn in progress. A second press within 2 seconds exits. |
| `Ctrl+O` | Expand or collapse tool inputs and results. |
| `Ctrl+T` | Show or hide reasoning. |
| `Ctrl+P` | Open the model and effort overlay. |

The editor autocompletes slash commands.

## Rendering

- The screen has 2 regions.
  The upper region is a `ScrollView` with the transcript. It follows the end while the user does not scroll.
  The lower region holds the status line, the editor, and the footer.
- A selection list shows as a centered overlay: a `Box` with the `surface` background, 2 columns and 1 row of padding, a title, the list, and a key hint line.
- A user prompt shows as a muted line that starts with `you>`.
- Assistant text streams into a `Markdown` component. The view renders it again on each delta.
- Reasoning streams as muted text above the reply. `Ctrl+T` hides it.
- A tool call shows as 1 line: a marker, the tool name, and the input cut to the terminal width.
  The marker is `>` while the call runs, `yes` on success, and `no` on failure.
  `Ctrl+O` shows the full input and output under each call.
- A `Loader` shows while a turn runs.
- The footer is 1 line: host, model, effort, context use, session cost, and the time of the last turn.

```text
claude - opus - high - ctx 41.2k/200k (21%) - $0.083 - 12.4s
```

## Changes and diffs

- The TUI takes a snapshot of `git diff --numstat HEAD -- functions/` and the untracked files under `functions/` when it starts.
- After each `tool_result`, the TUI takes a new snapshot and compares it with the previous one.
- Each changed file shows an inline line: `(edit) functions/<path> +N -M`.
- The TUI adds each changed path to a set for this run.
- `/diff` shows `git diff HEAD` for the paths in the set. An untracked file shows as a full addition.

## The /remember command

`/remember [instructions]` sends a normal turn to the current host with this prompt:

```text
[memory-checkpoint <ISO timestamp>]
Extract durable knowledge from this conversation since the previous
[memory-checkpoint] message, or from the start if none exists.
Store decisions, preferences, constraints, and dependencies with
memory.remember. Set source_session to <session id>.
<user instructions, if given>
```

The marker is part of the transcript, so the next call finds its start point also after a resume.

## Theme

`tui/theme.ts` defines 3 parts:

- `Palette` is a set of named color tokens.
- `Theme` holds the style functions that the TUI uses and the pi-tui component themes: `MarkdownTheme`, `EditorTheme`, and `SelectListTheme`.
- `createTheme(palette)` builds a `Theme` from a `Palette` with `styleText()` and `getTerminalColorMode()`.

The registry holds 1 theme, `alchemist`.
`ALCHEMIST_TUI_THEME` selects a theme by name, and the default is `alchemist`.
If the name is not in the registry, the TUI stops before it starts and lists the available names.
The text color and the screen background come from the terminal.
Overlays use the `surface` background.

### The alchemist palette

| Token | Color | Use |
| --- | --- | --- |
| `accent` | `oklch(80% 0.13 85)` | Headings, selected items, the editor prompt, the host name in the footer |
| `secondary` | `oklch(72% 0.10 190)` | Tool names, links, inline code |
| `muted` | `oklch(62% 0.01 260)` | User prompt lines, reasoning, descriptions, the footer |
| `border` | `oklch(45% 0.02 260)` | Editor border, code block border, quote border, rules |
| `success` | `oklch(72% 0.15 150)` | `yes` markers, added diff lines |
| `error` | `oklch(65% 0.18 25)` | `no` markers, removed diff lines, error lines |
| `warning` | `oklch(78% 0.14 70)` | The `~` cost marker, context use from 60% to 85% |
| `surface` | `oklch(27% 0.02 260)` | Overlay background |

Context use above 85% shows in `error`.

## Process output

The Elixir bridge and the Cursor server can write to the console.
While the TUI runs, it sends `console.log`, `console.info`, `console.warn`, and `console.error` to `.alchemist/tui/tui.log`.
The terminal shows only the TUI.

## Error handling

- If the Cursor server cannot start, the transcript shows the error. The session dialog still offers "New session", and `/host` can select Claude.
- If a turn fails, the transcript shows an `error` line and the session stays open.
- If an adapter call fails while the session list loads, the dialog shows the error and offers "New session".

## Testing

- `node:test` files under `tui/` cover `stats.ts`, `changes.ts`, `remember.ts`, `theme.ts`, and the event mapping of each adapter.
- The adapter tests use recorded SDK messages and Cursor NDJSON events. They make no network calls.
- `pnpm run test:tui` runs these tests. `pnpm test` also runs them.
- `tsconfig.json` includes `tui/**/*`, so `pnpm run check` checks the types.
- A manual smoke test runs 1 turn on each host, `/diff`, `/remember`, and a session resume.

## Documentation

- `docs/guides/tui.md` describes the start flow, commands, keys, footer, theme, and state files.
- `README.md` adds `pnpm run tui` to the quick start.
- `docs/index.md` lists the TUI guide.
- `docs/architecture/host-adapters.md` names the TUI as a client of both hosts.
- `AGENTS.md` adds `tui/` to the layout, `pnpm run tui` to the loop, and the pi-tui exception to the dependency rule.
- `docs/README.md` lists this spec.

## Out of scope

- Session resume for sessions from `pnpm run chat:claude`.
- Images.
- More than 1 theme.
- Permission prompts. Both hosts allow only the codex tools.
