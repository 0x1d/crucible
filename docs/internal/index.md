# Internal engineering records

These files capture decisions and implementation plans at a point in time. They do
not replace current public reference documentation under `docs/`.

| Record | Status | Scope |
| --- | --- | --- |
| [Documentation rewrite plan](./plans/2026-10-25-documentation-rewrite.md) | Completed | Restructuring the public documentation set. |
| [Nix direnv implementation plan](./plans/2026-10-25-nix-direnv.md) | Historical | Nix shell and direnv dev environment. |
| [Nix direnv design](./specs/2026-10-25-nix-direnv-design.md) | Historical | Design notes for the Nix/direnv workflow. |
| [Claude host design](./specs/2026-10-26-claude-host-design.md) | Implemented | Design of the Claude Agent SDK example host. |
| [Terminal UI design](./specs/2026-11-02-tui-design.md) | Implemented | Design of the terminal UI for the Claude and Cursor hosts. |
| [Cursor host context](./plans/2026-11-03-cursor-host-context.md) | Investigation | Why Cursor host prompts grow, and what the measured budgets are. |
| [Handoff tool](./plans/2026-11-03-handoff-tool.md) | Superseded | Replaced by the context handoff design. |
| [Context handoff design](./specs/2026-11-03-context-handoff-design.md) | Proposed | Handoff file plus the TUI fork that drops the old transcript. |
| [Context handoff plan](./plans/2026-11-03-context-handoff.md) | Proposed | Tasks and checks for the context handoff design. |
| [Prompt cache design](./specs/2026-11-03-prompt-cache-design.md) | Proposed | Pin the Cursor host model so a follow-up reuses the prefix. |
| [Prompt cache plan](./plans/2026-11-03-prompt-cache.md) | Proposed | Tasks and the two-turn cache gate for that design. |
