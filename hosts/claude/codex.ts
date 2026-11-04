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
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { repoRoot, runCodexOp } from "../../core/elixir-bridge.ts";
import { HOST_TOOL_NAMES, type CodexRequest } from "../../core/protocol.ts";
import {
  DEFAULT_READ_HTTP_MAX_BYTES,
  defaultStateRoot,
  loadMaxContextTokens,
  resolveHostFlags,
  type HostFlags,
} from "../cursor/bot/lib/host-flags.ts";
import { renderHandoff, type HandoffInput } from "../cursor/bot/lib/handoff.ts";
import { presentResult } from "../cursor/bot/lib/result-digest.ts";
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

async function codex(request: CodexRequest) {
  const result = (await runCodexOp(request)) as { ok?: boolean };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    isError: result.ok === false,
  };
}

async function callWithFlags(name: string, args: Record<string, unknown> | undefined) {
  const flags = claudeFlags();
  let callArgs = args ?? {};
  if (
    flags.defaultMaxBytes &&
    (name === "fs.read" || name === "http.get") &&
    callArgs.max_bytes === undefined
  ) {
    callArgs = { ...callArgs, max_bytes: DEFAULT_READ_HTTP_MAX_BYTES };
  }
  const result = (await runCodexOp({
    op: "call",
    name,
    args: callArgs,
  })) as { ok?: boolean };

  if (!flags.resultDigest) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: result.ok === false,
    };
  }

  const saved = path.join(repoRoot, "artifacts", `claude-${Date.now()}.json`);
  const presented = presentResult(result, saved);
  if (!presented.replace) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: result.ok === false,
    };
  }
  await mkdir(path.dirname(saved), { recursive: true });
  await writeFile(saved, presented.text);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(presented.value) }],
    isError: result.ok === false,
  };
}

const stringList = (max: number, maxLen: number) =>
  z.array(z.string().min(1).max(maxLen)).max(max).optional();

async function runHandoff(input: HandoffInput) {
  if (!claudeFlags().handoffTool) {
    return {
      content: [
        {
          type: "text" as const,
          text: "The handoff tool is disabled. Set historyReclaim to handoffFork (/flags reclaim handoffFork).",
        },
      ],
      isError: true,
    };
  }
  const text = renderHandoff(input);
  const bytes = Buffer.byteLength(text, "utf8");
  const filePath = path.join(repoRoot, "handoff.md");
  await writeFile(filePath, text, "utf8");
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          path: "handoff.md",
          bytes,
          confirmation: `Wrote handoff.md (${bytes} bytes).`,
        }),
      },
    ],
    isError: false,
  };
}

export const alchemistServer = createSdkMcpServer({
  name: "alchemist",
  version: "1.0.0",
  tools: [
    tool(
      HOST_TOOL_NAMES.find,
      "Search codex slugs by substring. Default: name, summary, and run/1 @spec per hit. detail: true only with an exact slug (not search).",
      {
        query: z.string().min(1).describe("Non-empty substring filter"),
        limit: z.number().int().min(1).max(40).optional(),
        detail: z
          .boolean()
          .optional()
          .describe("Exact slug only: full moduledoc and specs for that entry"),
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
      ({ name, args }) => callWithFlags(name, args),
    ),
    tool(
      "handoff",
      "Write handoff.md for a new session. Call when the user asks to compact, or says the context footer is yellow or red. Then stop. Do not mention /new.",
      {
        files: stringList(40, 240),
        systems: stringList(20, 120),
        pitfalls: stringList(12, 400),
        state: z.string().min(1).max(2_000),
        next: z.array(z.string().min(1).max(400)).min(1).max(12),
        facts: stringList(12, 400),
      },
      (input) => runHandoff(input),
    ),
  ],
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
