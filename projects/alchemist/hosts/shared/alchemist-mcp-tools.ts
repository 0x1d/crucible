/**
 * The shared codex tools as an MCP server factory for MCP-over-ACP.
 */
import { fromMcpServer } from "@agentclientprotocol/sdk/experimental/mcp-server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { stampSession } from "../claude/session-hook.ts";
import type { HostId } from "../cursor/bot/lib/host-flags.ts";
import { HANDOFF_TOOL_NAME, codexHostFlags, codexTools } from "./codex-tools.ts";

export type AlchemistMcpToolsOptions = {
  hostId: HostId;
  /** Live session id, stamped as `source_session` on `memory.remember` calls. */
  sessionId?: () => string | undefined;
};

export function alchemistMcpTools({ hostId, sessionId }: AlchemistMcpToolsOptions) {
  const tools = codexTools({
    hostId,
    prepareCall: (input) =>
      (stampSession(input, sessionId?.()) as typeof input | null) ?? input,
  });
  // The factory runs per MCP request, so a /flags change to the handoff tool applies at once.
  return fromMcpServer(() => {
    const server = new McpServer({ name: "alchemist", version: "1.0.0" });
    const handoff = codexHostFlags(hostId).handoffTool;
    for (const tool of tools) {
      if (tool.name === HANDOFF_TOOL_NAME && !handoff) continue;
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: z.object(tool.shape),
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        async (input: unknown) => {
          const { text, isError } = await tool.run(input);
          return { content: [{ type: "text" as const, text }], isError };
        },
      );
    }
    return server;
  });
}
