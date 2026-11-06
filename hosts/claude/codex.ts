/**
 * Example Alchemist host on the Claude Agent SDK.
 * The four codex operations run as an in-process MCP server; the Elixir bridge owns the long-lived BEAM.
 * Host flags (shared with Cursor) control autocompact vs handoff reclaim, result digests, and caps.
 */
import {
  createSdkMcpServer,
  tool,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../../core/elixir-bridge.ts";
import { HOST_TOOL_NAMES } from "../../core/protocol.ts";
import {
  defaultStateRoot,
  loadMaxContextTokens,
  resolveHostFlags,
  type HostFlags,
} from "../cursor/bot/lib/host-flags.ts";
import { codexTools } from "../shared/codex-tools.ts";
import { sessionHooks } from "./session-hook.ts";

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const claudeStateRoot = defaultStateRoot("claude");

export function claudeFlags(): HostFlags {
  return resolveHostFlags(claudeStateRoot, "claude");
}

/** `maxContextTokens` from host-flags.json, clamped to the SDK autoCompactWindow range. */
export function claudeAutoCompactWindow(): number {
  return Math.min(1_000_000, Math.max(100_000, loadMaxContextTokens(claudeStateRoot, "claude")));
}

export const alchemistServer = createSdkMcpServer({
  name: "alchemist",
  version: "1.0.0",
  tools: codexTools({ hostId: "claude" }).map((definition) =>
    tool(
      definition.name,
      definition.description,
      definition.shape,
      async (input) => {
        const { text, isError } = await definition.run(input);
        return { content: [{ type: "text" as const, text }], isError };
      },
      definition.annotations ? { annotations: definition.annotations } : undefined,
    ),
  ),
});

/** Fully qualified tool names as Claude sees them. */
export const ALCHEMIST_TOOLS = [
  ...Object.values(HOST_TOOL_NAMES).map((name) => `mcp__alchemist__${name}`),
  "mcp__alchemist__handoff",
];

export const instructions = fs.readFileSync(
  path.join(hostDir, "instructions.md"),
  "utf8",
);

/**
 * Query options: minimal prompt, codex tools only, no built-in tools, no local settings,
 * and no MCP servers besides the codex server.
 *
 * History reclaim is exclusive via host flags (Claude SDK mode is autocompact only):
 * - autocompact → settings.autoCompactEnabled, compacting at maxContextTokens (autoCompactWindow)
 * - handoffFork → handoff tool + TUI fork (autoCompact off)
 * - off → neither
 */
export function alchemistOptions(): Options {
  const flags = claudeFlags();
  return {
    cwd: repoRoot,
    systemPrompt: instructions,
    tools: [],
    mcpServers: { alchemist: alchemistServer },
    strictMcpConfig: true,
    settings: {
      disableClaudeAiConnectors: true,
      autoCompactEnabled: flags.autoCompact,
      idleCompaction: flags.autoCompact,
      ...(flags.autoCompact ? { autoCompactWindow: claudeAutoCompactWindow() } : {}),
    },
    allowedTools: flags.handoffTool
      ? ALCHEMIST_TOOLS
      : ALCHEMIST_TOOLS.filter((name) => name !== "mcp__alchemist__handoff"),
    permissionMode: "default",
    settingSources: [],
    // Stamps the live session id onto memory.remember (see session-hook.ts).
    hooks: { PreToolUse: sessionHooks },
  };
}
