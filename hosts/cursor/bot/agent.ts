import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  // Cursor Auto (server-side model routing). Use auto-smart + optimize_for for Router.
  model: "auto",
  // Empty allowlist: no read, edit, shell, or other native tools.
  // Authored codex tools still reach the model over MCP.
  // Workspaces live in hosts/cursor/.sessions (gitignored). Each session
  // directory is its own git root, so turns do not inherit this checkout's
  // AGENTS.md or ambient MCP servers.
  local: { cwd: ".sessions" },
  tools: [],
});
