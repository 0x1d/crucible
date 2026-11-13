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
| OI-02 | The design sub-documents taken over from the dated plans and specs still read as plans (task lists, progress notes) | Rewrite each descriptively when its planned change is finished | crucible/alchemist/host-cursor/design | Open |
| OI-03 | The hosts under `hosts/nshde` and `hosts/shared` have no documents | Add a manifest and design for the athanor sidecar | crucible/alchemist/architecture/host-adapters | Open |
| OI-04 | How the `serve` channel routes to an ACP agent: which host events it streams to match `channels/http.ts`, and the permission policy without a person to ask (`denyPermission` is the current default) | Define the streaming contract of `channels/http.ts`, then write a **Planned** section in crucible/alchemist/host-acp/design | crucible/alchemist/host-acp | Open |
| OI-05 | Whether to support agents reached over HTTP or WebSocket (`@agentclientprotocol/sdk/experimental/http-client`, `ws-client`) | Find a target agent without stdio ACP; until then stdio only | crucible/alchemist/host-acp | Open |
| OI-06 | Whether to move to ACP v2 | Only if a target agent requires it | crucible/alchemist/host-acp | Open |
