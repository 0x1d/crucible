---
title: Terminal UI
description: Start flow, commands, keys, footer, theme, and state files of the Alchemist terminal UI.
project: alchemist
tags: [tui, host, claude, cursor, guide]
---

# Terminal UI

The terminal UI runs one Alchemist host in the terminal.
It streams replies, reasoning, and tool calls, and it shows context use and session cost.
The code is in `tui/`.
It imports the hosts, and no host imports it.
It uses `@earendil-works/pi-tui` for rendering.

The host registry holds the Claude Agent SDK host and the Cursor Agent SDK host.

## Start the TUI

Prerequisites: Node 24+, Elixir 1.20+ on `PATH`, and credentials for the host you select.
Claude uses Claude Code credentials or `ANTHROPIC_API_KEY`.
Cursor uses a Cursor credential (`CURSOR_API_KEY`, `CURSOR_API_KEY_FILE`, `CURSOR_SERVICE_ACCOUNT_KEY`, or `agent-sdk login`).

1. Run the TUI:

   ```bash
   npm run tui
   ```

2. Select a host in the dialog.
3. Select a session in the next dialog. "New session" is the first item.
4. Type a prompt and press `Enter`.

The transcript replays an opened session before the editor gets focus.

The TUI uses the alternate screen of the terminal.
The transcript fills the upper part of the screen and scrolls.
The status line, the editor, and the footer stay at the bottom.
When the TUI exits, the terminal shows the main screen again with the transcript printed on it.

## Commands

| Command | Action |
| --- | --- |
| `/host` | Select a host, then a session of that host. |
| `/session` | Select a session of the current host. |
| `/new` | Start a new session on the current host. |
| `/model [id]` | Set the model. Without an id, open the model list. |
| `/effort [level]` | Set the effort level. Without a level, open the effort list. |
| `/diff` | Show a colored diff of the files under `functions/` that changed while the TUI runs. |
| `/remember [instructions]` | Ask the host to store knowledge from the conversation with `memory.remember`. |
| `/exit` | Exit the TUI. |

The editor autocompletes slash commands.

A model or effort change applies to the next turn of the Claude host.
The session continues.
On the Cursor host, the model is set in `hosts/cursor/bot/agent.ts` when the serve process starts.
The TUI saves your picker choice in `hosts/cursor/.agent-serve/host-flags.json` as `sessionModel`.
**Exit and restart the TUI** after changing model or `/ctx on pinnedModel` so the serve host reloads.
Agent SDK 0.5.0 does not accept `modelConfig` on live `POST /v1/session` (only with `dryRun`).
`/new` starts a new conversation on the **same** agent model; it does not apply a mid-run picker change.
A Cursor follow-up sends the new prompt and the current continuation token.
The server resumes the same agent, so earlier turns are not sent again.
The transcript stream starts at the last event index plus 1.

### The /remember prompt

`/remember` sends a normal turn.
The prompt starts with a `[memory-checkpoint <ISO timestamp>]` line.
It asks the host to extract decisions, preferences, constraints, and dependencies since the previous checkpoint line, or from the start of the conversation.
The host stores them with `memory.remember` and sets `source_session` to the session id.
Text after the command goes at the end of the prompt.
The checkpoint lines are part of the transcript, so a resumed session keeps them.

## Keys

| Key | Action |
| --- | --- |
| `Enter` | Send the prompt. |
| `Shift+Enter` or `Ctrl+J` | Add a new line. |
| `Up`, `Down` | Move through the prompt history of this run. |
| `Esc` | Stop the turn in progress. |
| `Ctrl+C` | Stop the turn in progress. A second press within 2 seconds exits. |
| `Ctrl+O` | Expand or collapse tool inputs and results. |
| `Ctrl+T` | Show or hide reasoning. |
| `Ctrl+P` | Open the model list, then the effort list of the selected model. |
| `PageUp`, `PageDown`, mouse wheel | Scroll the transcript. |
| `Ctrl+Home`, `Ctrl+End` | Scroll to the start or the end of the transcript. |
| `Ctrl+Shift+F` | Search the transcript. |

## Transcript

- A user prompt shows as a muted line that starts with `you>`.
- A reply streams as Markdown.
- Reasoning streams as muted italic text.
- A tool call is 1 line. The marker is `▸` while it runs, `✓` on success, and `✗` on failure.
- A file change under `functions/` shows as `✎ functions/<path> +N −M` after the tool result.
- Each finished turn adds a token line below its reply.
- Tool calls and file changes for that turn stay above the token line.
- The line shows that turn's context use, cache result, cache read, cache write, and new tokens, in the same colors as the footer.
- A turn that reports no context size omits the line.

## Dialogs

The host, session, model, and effort lists show as dialogs in the center of the screen.
A dialog has the `surface` background, a title, the list, and a key hint line.
`Up` and `Down` move the selection, `Enter` selects, and `Esc` closes the dialog.

## Footer

The footer shows the host, the model, the effort level, the context use, the prompt-cache result, the session cost, and the time of the last turn.

```text
claude · opus · high · ctx 90.1k/200k (45%) · hit · read 80.9k · write 0 · new 9.2k · $0.083 · 12.4s
```

| Field | Source |
| --- | --- |
| Context | The prompt size of the last turn. Claude adds input, cache-read, and cache-write, which are disjoint. Cursor uses input when that count already includes the cache, and adds the cache buckets when input is smaller than them. The Claude window comes from the SDK result. The Cursor window is 200,000 tokens. |
| Cache | `hit` when the last turn read from the prompt cache, `miss` when the host reported a read of zero. `read` and `write` are the cache-read and cache-write token counts. `new` is the rest of the prompt (`context − read − write`). A turn that does not report cache counters omits these fields. |
| Cost | The running total of the session. Claude uses `total_cost_usd` of the latest SDK result. Cursor uses `costUsd` from `GET /v1/session/:id/cost`. |

The context field, including the percentage, is green below 150,000 tokens, yellow from 150,000 through 200,000 tokens, and red above 200,000 tokens.
`hit`, `read`, and `write` use the success color.
`miss` uses the warning color.
The new token count uses the accent color.
A replayed session has no cost data for its earlier turns.
Its cost shows with a `~` prefix in the warning color until the first turn finishes.
The total of that turn includes the earlier turns, so the prefix goes away.

## Theme

`tui/theme.ts` defines the palette tokens, the `Theme` type, and the theme registry.
`createTheme()` builds the pi-tui `MarkdownTheme`, `EditorTheme`, and `SelectListTheme` from one palette.
`ALCHEMIST_TUI_THEME` selects a theme by name.
The default is `alchemist`, the only theme in the registry.
An unknown name stops the TUI before it starts and lists the available names.
The terminal sets the text color and the screen background.
Dialogs use the `surface` background.

| Token | Color | Use |
| --- | --- | --- |
| `accent` | `oklch(80% 0.13 85)` | Headings, selected items, the host name, new prompt tokens |
| `secondary` | `oklch(72% 0.10 190)` | Tool names, links, inline code, diff hunk headers |
| `muted` | `oklch(62% 0.01 260)` | User prompt lines, reasoning, descriptions, the footer |
| `border` | `oklch(45% 0.02 260)` | Editor border, code block border, quote border, rules |
| `success` | `oklch(72% 0.15 150)` | `✓` markers, added diff lines, context below 150,000 tokens, cache hits, cache read/write counts |
| `error` | `oklch(65% 0.18 25)` | `✗` markers, removed diff lines, error lines, context above 200,000 tokens |
| `warning` | `oklch(78% 0.14 70)` | Partial cost, cache misses, context from 150,000 through 200,000 tokens |
| `surface` | `oklch(27% 0.02 260)` | Dialog background |

## State files

| Path | Content |
| --- | --- |
| `.alchemist/tui/claude-sessions.json` | Ids of the Claude sessions that the TUI created. The session list shows only these sessions. |
| `.alchemist/tui/tui.log` | Console output of the TUI process, the Elixir bridge, and the hosts. |
| `hosts/cursor/.agent-serve` | Session state for the Cursor host. This is the same directory `agent-sdk dev --dir hosts/cursor` uses. |

The repository `.gitignore` ignores `.alchemist/` and `.agent-serve`.
The Claude Agent SDK stores the session transcripts under `~/.claude/projects/`.
The TUI and `agent-sdk dev --dir hosts/cursor` should not serve `hosts/cursor/.agent-serve` at the same time.

## Tests

```bash
npm run test:tui
```

The tests under `tui/` cover the theme, stats, change tracking, the `/remember` prompt, the command parser, the view components, and the Claude and Cursor event mapping.
They use recorded SDK messages and temporary git repositories, and they make no network calls.
