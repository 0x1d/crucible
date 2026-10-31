import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  // Cursor Auto (server-side model routing). Use auto-smart + optimize_for for Router.
  model: "auto",
  // Empty allowlist: no read, edit, shell, or other native tools.
  // Authored codex tools still reach the model over MCP.
  // local.cwd stays unset so the session workspace stays outside this
  // checkout and does not inherit its AGENTS.md or ambient MCP servers.
  tools: [],
});
