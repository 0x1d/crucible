---
title: Terminal UI design
description: Design of a minimal terminal UI that runs the Claude and Cursor hosts with streamed output, session selection, and usage tracking.
project: alchemist
tags: [tui, host, claude, cursor, design]
---

# Terminal UI design

Status: Proposed.

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
| Renderer | `TuiMainScreen` | The terminal keeps its scrollback. No alternate screen. |
| Host contract | One `HostAdapter` interface with a normalized event stream | Rendering and stats code is the same for both hosts. |
| Claude transport | `query()` with `alchemistOptions()` from `hosts/claude/codex.ts` | Reuses the host as it is. |
| Cursor transport | `serve("hosts/cursor", { mode: "single", port: 0 })` in the TUI process, then the HTTP session API | No child process and no port discovery. |
| Cursor context window | Fixed at 200,000 tokens | Model `auto` reports no window size. |
| Session index for Claude | `.alchemist/tui/sessions.json` | `listSessions()` for the repository root also returns Claude Code CLI sessions. The index keeps only sessions that the TUI created. |
| Memory checkpoint | A marker line inside the `/remember` prompt | The transcript holds the checkpoint. The TUI keeps no state for it. |
| Theme | One theme, `alchemist`, in a theme registry | Every component reads its styles from the active theme. |
| Script | `npm run tui` runs `node tui/main.ts` | Matches `npm run chat:claude`. |

## Layout

```text
tui/
  main.ts            start flow, slash commands, key bindings, wiring
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
  readonly name: "claude" | "cursor";
  listSessions(): Promise<SessionSummary[]>;
  openSession(id: string | undefined): Promise<HostEvent[]>; // replayed events
  listModels(): Promise<ModelChoice[]>;
  setModel(model: string, effort: string | undefined): Promise<void>;
  send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent>;
  close(): Promise<void>;
}
```

`openSession(undefined)` starts a new session.
`send()` stops the turn when the signal aborts.

### Events

| Event | Fields | Claude source | Cursor source |
| --- | --- | --- | --- |
| `text` | `delta` | `stream_event` with a text `content_block_delta` | `message.appended` |
| `reasoning` | `delta` | `stream_event` with a `thinking_delta` | `reasoning.appended` |
| `tool` | `id`, `name`, `input` | `tool_use` block in an `assistant` message | `actions.requested` |
| `tool_result` | `id`, `ok`, `output` | `tool_result` block in a `user` message | `action.result` |
| `usage` | `contextTokens`, `contextWindow`, `costUsd` | `result` message | `turn.completed`, then `GET /v1/session/:id/cost` |
| `done` | `sessionId` | `result` with `subtype: "success"` | `turn.completed` |
| `error` | `message` | `result` with an error subtype | `turn.failed` or an HTTP error |

### Claude adapter

- `send()` calls `query()` with `alchemistOptions()`, `includePartialMessages: true`, `resume`, `model`, and `effort`.
- A model or effort change applies on the next turn. The session continues.
- `listModels()` reads `supportedModels()`, which also gives the effort levels of each model.
- `listSessions()` calls `listSessions({ dir: <repo root> })` and keeps the ids in the session index.
- `openSession(id)` replays `getSessionMessages(id)` as events.
- The adapter writes each new session id to the session index after the first `result` message.

### Cursor adapter

- The adapter starts the in-process server on first use with the same state root as `agent-sdk dev`.
- `openSession(undefined)` defers creation to the first `send()`, which calls `POST /v1/session` with `modelConfig`.
- Later turns call `POST /v1/session/:id` with the current continuation token.
- `send()` reads `GET /v1/session/:id/stream` from the last index plus 1 until `turn.completed` or `turn.failed`.
- An aborted signal calls `POST /v1/session/:id/stop`.
- `listSessions()` calls `GET /v1/sessions`.
- `openSession(id)` replays `GET /v1/session/:id/events`.
- `listModels()` returns a fixed list: `auto`, `composer-2.5`, `grok-4.7`. The user can also type a model id.
- Effort maps to the model param `reasoning_effort` with the values `low`, `medium`, and `high`.
- The SDK fixes `modelConfig` when it creates a session. A model or effort change on an existing Cursor session starts a new session. The TUI tells the user before it does this.

## Stats

- Context tokens are the input, cache-read, and cache-write tokens of the last model call in the last turn.
- The context window comes from `modelUsage[model].contextWindow` for Claude and is 200,000 for Cursor.
- Session cost for Claude is the sum of `total_cost_usd` over the turns.
- Session cost for Cursor is `costUsd` from the cost route for the whole session.
- An opened session starts from the usage in its replayed events.
- If the replay has no cost data, the cost starts at 0 and the footer shows it with a `~` prefix.
- A new session, `/new`, `/session`, and `/host` set the stats to the values of the session that opens.

## Start flow and commands

1. Select a host in a `SelectList`.
2. Select a session in a second `SelectList`. "New session" is the first item.
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

- A user prompt shows as a muted line that starts with `you>`.
- Assistant text streams into a `Markdown` component. The view renders it again on each delta.
- Reasoning streams as muted text above the reply. `Ctrl+T` hides it.
- A tool call shows as 1 line: a marker, the tool name, and the input cut to the terminal width.
  The marker is `▸` while the call runs, `✓` on success, and `✗` on failure.
  `Ctrl+O` shows the full input and output under each call.
- A `Loader` shows while a turn runs.
- The footer is 1 line: host, model, effort, context use, session cost, and the time of the last turn.

```text
claude · opus · high · ctx 41.2k/200k (21%) · $0.083 · 12.4s
```

## Changes and diffs

- The TUI takes a snapshot of `git diff --numstat HEAD -- functions/` and the untracked files under `functions/` when it starts.
- After each `tool_result`, the TUI takes a new snapshot and compares it with the previous one.
- Each changed file shows an inline line: `✎ functions/<path> +N −M`.
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
The text color and the background color come from the terminal.

### The alchemist palette

| Token | Color | Use |
| --- | --- | --- |
| `accent` | `oklch(80% 0.13 85)` | Headings, selected items, the editor prompt, the host name in the footer |
| `secondary` | `oklch(72% 0.10 190)` | Tool names, links, inline code |
| `muted` | `oklch(62% 0.01 260)` | User prompt lines, reasoning, descriptions, the footer |
| `border` | `oklch(45% 0.02 260)` | Editor border, code block border, quote border, rules |
| `success` | `oklch(72% 0.15 150)` | `✓` markers, added diff lines |
| `error` | `oklch(65% 0.18 25)` | `✗` markers, removed diff lines, error lines |
| `warning` | `oklch(78% 0.14 70)` | The `~` cost marker, context use from 60% to 85% |

Context use above 85% shows in `error`.

## Process output

The Elixir bridge and the Cursor server can write to the console.
While the TUI runs, it sends `console.log`, `console.info`, `console.warn`, and `console.error` to `.alchemist/tui/tui.log`.
The terminal shows only the TUI.

## Error handling

- If the Cursor server cannot start, the host picker shows the error and the user can select Claude.
- If a turn fails, the transcript shows an `error` line and the session stays open.
- If an adapter call fails while the session list loads, the dialog shows the error and offers "New session".

## Testing

- `node:test` files under `tui/` cover `stats.ts`, `changes.ts`, `remember.ts`, `theme.ts`, and the event mapping of each adapter.
- The adapter tests use recorded SDK messages and Cursor NDJSON events. They make no network calls.
- `npm run test:tui` runs these tests. `npm test` also runs them.
- `tsconfig.json` includes `tui/**/*`, so `npm run check` checks the types.
- A manual smoke test runs 1 turn on each host, `/diff`, `/remember`, and a session resume.

## Documentation

- `docs/guides/tui.md` describes the start flow, commands, keys, footer, theme, and state files.
- `README.md` adds `npm run tui` to the quick start.
- `docs/index.md` lists the TUI guide.
- `docs/reference/hosts.md` names the TUI as a client of both hosts.
- `AGENTS.md` adds `tui/` to the layout, `npm run tui` to the loop, and the pi-tui exception to the dependency rule.
- `docs/internal/index.md` lists this spec.

## Out of scope

- Session resume for sessions from `npm run chat:claude`.
- Mouse support, the alternate screen, and images.
- More than 1 theme.
- Permission prompts. Both hosts allow only the codex tools.
