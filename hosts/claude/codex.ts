/**
 * Example Alchemist host on the Claude Agent SDK.
 * The four codex operations run as an in-process MCP server; the Elixir bridge owns the long-lived BEAM.
 */
import {
  createSdkMcpServer,
  tool,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { repoRoot, runCodexOp } from "../../core/elixir-bridge.ts";
import { HOST_TOOL_NAMES, type CodexRequest } from "../../core/protocol.ts";
import { sessionHooks } from "./session-hook.ts";

const hostDir = path.dirname(fileURLToPath(import.meta.url));

async function codex(request: CodexRequest) {
  const result = (await runCodexOp(request)) as { ok?: boolean };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    isError: result.ok === false,
  };
}

export const alchemistServer = createSdkMcpServer({
  name: "alchemist",
  version: "1.0.0",
  tools: [
    tool(
      HOST_TOOL_NAMES.find,
      "Search codex slugs by substring. Default: name and one-line summary per hit.",
      {
        query: z.string().min(1).describe("Non-empty substring filter"),
        limit: z.number().int().min(1).max(40).optional(),
        detail: z.boolean().optional(),
      },
      ({ query, limit, detail }) =>
        codex({
          op: "find",
          query,
          ...(limit !== undefined ? { limit } : {}),
          ...(detail !== undefined ? { detail } : {}),
        }),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      HOST_TOOL_NAMES.define,
      "Persist a new Elixir codex entry on disk. Provide a complete AgentFn.<Name> defmodule with run/1, or only run/1.",
      {
        name: z.string().describe("Codex slug: snake_case, dot namespaces allowed (e.g. pipeline.demo)"),
        source: z.string().describe("Elixir source for run/1 or a complete defmodule block"),
        description: z.string().optional().describe("Short summary stored for find_function"),
      },
      (args) => codex({ op: "define", ...args }),
    ),
    tool(
      HOST_TOOL_NAMES.load,
      "Compile and load a defined Elixir codex entry into the running runtime.",
      { name: z.string().describe("Function slug to load") },
      ({ name }) => codex({ op: "load", name }),
      { annotations: { idempotentHint: true } },
    ),
    tool(
      HOST_TOOL_NAMES.call,
      "Invoke a codex entry's run/1 by slug with a JSON args object. Loads from disk when needed.",
      {
        name: z.string().describe("Function slug to call"),
        args: z.record(z.string(), z.unknown()).optional().describe("JSON object passed to run/1"),
      },
      ({ name, args }) => codex({ op: "call", name, args: args ?? {} }),
    ),
  ],
});

/** Fully qualified tool names as Claude sees them. */
export const ALCHEMIST_TOOLS = Object.values(HOST_TOOL_NAMES).map(
  (name) => `mcp__alchemist__${name}`,
);

export const instructions = fs.readFileSync(
  path.join(hostDir, "instructions.md"),
  "utf8",
);

/**
 * Query options: minimal prompt, codex tools only, no built-in tools, no local settings,
 * and no MCP servers besides the codex server.
 *
 * claude.ai connectors load even with `settingSources: []`. Their tools are not in
 * `allowedTools`, so the model cannot use them, but their schemas add tens of thousands
 * of tokens to every request. They also connect in the background, so the tool list
 * changes during a session and the prompt cache has to be written again.
 */
export function alchemistOptions(): Options {
  return {
    cwd: repoRoot,
    systemPrompt: instructions,
    tools: [],
    mcpServers: { alchemist: alchemistServer },
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true },
    allowedTools: ALCHEMIST_TOOLS,
    permissionMode: "default",
    settingSources: [],
    // Stamps the live session id onto memory.remember (see session-hook.ts).
    hooks: { PreToolUse: sessionHooks },
  };
}
