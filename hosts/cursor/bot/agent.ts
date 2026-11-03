import { defineAgent } from "@grok/agent-sdk";

import { effectiveContextImprovements } from "./lib/context-improvements.ts";
import { PINNED_MODEL } from "./model.ts";

const ctx = effectiveContextImprovements();

export default defineAgent({
  model: ctx.pinnedModel ? PINNED_MODEL : "auto",
  // MCP only: the custom-user-tools server and its four codex tools.
  // No read, edit, shell, or other native tools.
  // Workspaces live in hosts/cursor/.sessions (gitignored). Each session
  // directory is its own git root, so turns do not inherit this checkout's
  // AGENTS.md or ambient MCP servers.
  local: { cwd: ".sessions" },
  tools: ["mcp"],
});
