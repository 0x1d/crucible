---
title: Terminal UI
description: Start flow, commands, keys, footer, theme, and state files of the Alchemist terminal UI.
project: alchemist
tags: [tui, host, claude, guide]
---

# Terminal UI

The terminal UI runs one Alchemist host in the terminal.
It streams replies, reasoning, and tool calls, and it shows context use and session cost.
The code is in `tui/`.
It imports the hosts, and no host imports it.
It uses `@earendil-works/pi-tui` for rendering.

The host registry holds the Claude Agent SDK host.

## Start the TUI

Prerequisites: Node 24+, Elixir 1.20+ on `PATH`, and Claude Code credentials or `ANTHROPIC_API_KEY`.

1. Run the TUI:

   ```bash
   npm run tui
   ```

2. Select a host.
3. Select a session. "New session" is the first item.
4. Type a prompt and press `Enter`.

The transcript replays an opened session before the editor gets focus.

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

## Transcript

- A user prompt shows as a muted line that starts with `you>`.
- A reply streams as Markdown.
- Reasoning streams as muted italic text.
- A tool call is 1 line. The marker is `▸` while it runs, `✓` on success, and `✗` on failure.
- A file change under `functions/` shows as `✎ functions/<path> +N −M` after the tool result.

## Footer

The footer shows the host, the model, the effort level, the context use, the session cost, and the time of the last turn.

```text
claude · opus · high · ctx 41.2k/200k (21%) · $0.083 · 12.4s
```

| Field | Source |
| --- | --- |
| Context | Input, cache-read, and cache-write tokens of the last model call. The window comes from the SDK result. |
| Cost | Sum of `total_cost_usd` over the turns of this run. |

The context field is muted below 60%, warning from 60% to 85%, and error above 85%.
A replayed session has no cost data for its earlier turns.
Its cost shows with a `~` prefix in the warning color.

## Theme

`tui/theme.ts` defines the palette tokens, the `Theme` type, and the theme registry.
`createTheme()` builds the pi-tui `MarkdownTheme`, `EditorTheme`, and `SelectListTheme` from one palette.
`ALCHEMIST_TUI_THEME` selects a theme by name.
The default is `alchemist`, the only theme in the registry.
An unknown name stops the TUI before it starts and lists the available names.
The terminal sets the text color and the background color.

| Token | Color | Use |
| --- | --- | --- |
| `accent` | `oklch(80% 0.13 85)` | Headings, selected items, the host name |
| `secondary` | `oklch(72% 0.10 190)` | Tool names, links, inline code, diff hunk headers |
| `muted` | `oklch(62% 0.01 260)` | User prompt lines, reasoning, descriptions, the footer |
| `border` | `oklch(45% 0.02 260)` | Editor border, code block border, quote border, rules |
| `success` | `oklch(72% 0.15 150)` | `✓` markers, added diff lines |
| `error` | `oklch(65% 0.18 25)` | `✗` markers, removed diff lines, error lines |
| `warning` | `oklch(78% 0.14 70)` | Partial cost, context use from 60% to 85% |

## State files

| Path | Content |
| --- | --- |
| `.alchemist/tui/claude-sessions.json` | Ids of the Claude sessions that the TUI created. The session list shows only these sessions. |
| `.alchemist/tui/tui.log` | Console output of the TUI process, the Elixir bridge, and the hosts. |

The repository `.gitignore` ignores `.alchemist/`.
The Claude Agent SDK stores the session transcripts under `~/.claude/projects/`.

## Tests

```bash
npm run test:tui
```

The tests under `tui/` cover the theme, stats, change tracking, the `/remember` prompt, the command parser, the view components, and the Claude event mapping.
They use recorded SDK messages and temporary git repositories, and they make no network calls.
