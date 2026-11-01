import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  // Cursor Auto (server-side model routing). Use auto-smart + optimize_for for Router.
  model: "auto",
  // MCP only: the custom-user-tools server and its four codex tools.
  // No read, edit, shell, or other native tools.
  // Workspaces live in hosts/cursor/.sessions (gitignored). Each session
  // directory is its own git root, so turns do not inherit this checkout's
  // AGENTS.md or ambient MCP servers.
  local: { cwd: ".sessions" },
  tools: ["mcp"],
});
