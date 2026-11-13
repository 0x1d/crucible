---
id: crucible/alchemist/open-items
title: Open Items
type: OI
owner: crucible/alchemist
status: Draft
date: 2026-11-13
related: []
---

# Open Items

| Id | Question | Next step | Affects | Status |
| --- | --- | --- | --- | --- |
| OI-01 | Documents of the required sets are not written yet: requirements and verification for every component except crucible/alchemist/host-acp, operations for the runtime, interface mappings for the Claude and Cursor hosts, ux for the terminal UI | Write them from the existing documents and the code, as for crucible/alchemist/host-acp | crucible/alchemist/runtime, crucible/alchemist/codex-protocol, crucible/alchemist/tui, crucible/alchemist/host-claude, crucible/alchemist/host-cursor | Open |
| OI-02 | The design sub-documents taken over from the dated plans and specs still read as plans (task lists, progress notes) | Rewrite each descriptively when its planned change is finished | crucible/alchemist/host-cursor/design | Closed by crucible/alchemist/host-cursor/AD-15 |
| OI-03 | The hosts under `hosts/nshde` and `hosts/shared` have no documents | Add a manifest and design for the athanor sidecar | crucible/alchemist/architecture/host-adapters | Open |
| OI-04 | How the `serve` channel routes to an ACP agent: which host events it streams to match `channels/http.ts`, and the permission policy without a person to ask (`denyPermission` is the current default) | Define the streaming contract of `channels/http.ts`, then write a **Planned** section in crucible/alchemist/host-acp/design | crucible/alchemist/host-acp | Open |
| OI-05 | Whether to support agents reached over HTTP or WebSocket (`@agentclientprotocol/sdk/experimental/http-client`, `ws-client`) | Find a target agent without stdio ACP; until then stdio only | crucible/alchemist/host-acp | Open |
| OI-06 | Whether to move to ACP v2 | Only if a target agent requires it | crucible/alchemist/host-acp | Open |
| OI-07 | The Cursor reclaim mode `summarize` is accepted by the host flags but does nothing: `@grok/agent-sdk` does not expose the Cursor SDK's summarize on the HTTP session path | Wire it when the SDK exposes it, or remove the mode from `reclaimModesForHost("cursor")` | crucible/alchemist/host-cursor/design/host-flags | Open |
| OI-08 | Whether the Claude host should shrink tool results in a `PostToolUse` hook (`updatedToolOutput`) instead of the shared emit-time digest | Compare both on the Claude evals | crucible/alchemist/host-claude | Open |
| OI-09 | On the same one-line read, the TUI's cached prefix was 80,896 tokens and the playground's 32,384; the cause is not known | Re-run the read in the TUI with Elixir on `PATH` and record input, cache read and cache write | crucible/alchemist/host-cursor/design/context-budget | Open |
