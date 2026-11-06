/**
 * The codex tools as plain definitions, shared by hosts that register them on an MCP server.
 * One naming contract (`HOST_TOOL_NAMES`), one bridge (`runCodexOp`), and one set of schemas.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";
import { repoRoot, runCodexOp } from "../../core/elixir-bridge.ts";
import { HOST_TOOL_NAMES, type CodexRequest } from "../../core/protocol.ts";
import { renderHandoff, type HandoffInput } from "../cursor/bot/lib/handoff.ts";
import {
  DEFAULT_READ_HTTP_MAX_BYTES,
  defaultStateRoot,
  resolveHostFlags,
  type HostFlags,
  type HostId,
} from "../cursor/bot/lib/host-flags.ts";
import { presentResult } from "../cursor/bot/lib/result-digest.ts";

export const HANDOFF_TOOL_NAME = "handoff";

export type CodexToolOutput = { text: string; isError: boolean };

export type CodexToolDefinition = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
  // Each schema narrows its own input, so the common type cannot name it.
  run: (input: any) => Promise<CodexToolOutput>;
};

export function codexHostFlags(hostId: HostId): HostFlags {
  return resolveHostFlags(defaultStateRoot(hostId), hostId);
}

const stringList = (max: number, maxLen: number) =>
  z.array(z.string().min(1).max(maxLen)).max(max).optional();

async function codex(request: CodexRequest): Promise<CodexToolOutput> {
  const result = (await runCodexOp(request)) as { ok?: boolean };
  return { text: JSON.stringify(result), isError: result.ok === false };
}

async function callWithFlags(
  hostId: HostId,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<CodexToolOutput> {
  const flags = codexHostFlags(hostId);
  let callArgs = args ?? {};
  if (
    flags.defaultMaxBytes &&
    (name === "fs.read" || name === "http.get") &&
    callArgs.max_bytes === undefined
  ) {
    callArgs = { ...callArgs, max_bytes: DEFAULT_READ_HTTP_MAX_BYTES };
  }
  const result = (await runCodexOp({ op: "call", name, args: callArgs })) as { ok?: boolean };
  const isError = result.ok === false;
  if (!flags.resultDigest) return { text: JSON.stringify(result), isError };

  const saved = path.join(repoRoot, "artifacts", `${hostId}-${Date.now()}.json`);
  const presented = presentResult(result, saved);
  if (!presented.replace) return { text: JSON.stringify(result), isError };
  await mkdir(path.dirname(saved), { recursive: true });
  await writeFile(saved, presented.text);
  return { text: JSON.stringify(presented.value), isError };
}

async function runHandoff(hostId: HostId, input: HandoffInput): Promise<CodexToolOutput> {
  if (!codexHostFlags(hostId).handoffTool) {
    return {
      text: "The handoff tool is disabled. Set historyReclaim to handoffFork (/flags reclaim handoffFork).",
      isError: true,
    };
  }
  const text = renderHandoff(input);
  const bytes = Buffer.byteLength(text, "utf8");
  await writeFile(path.join(repoRoot, "handoff.md"), text, "utf8");
  return {
    text: JSON.stringify({
      path: "handoff.md",
      bytes,
      confirmation: `Wrote handoff.md (${bytes} bytes).`,
    }),
    isError: false,
  };
}

export type CodexToolsOptions = {
  hostId: HostId;
  /** Rewrites `call_function` input before it runs, such as a session stamp. */
  prepareCall?: (input: { name: string; args?: Record<string, unknown> }) => {
    name: string;
    args?: Record<string, unknown>;
  };
};

export function codexTools({ hostId, prepareCall }: CodexToolsOptions): CodexToolDefinition[] {
  return [
    {
      name: HOST_TOOL_NAMES.find,
      description:
        "Search codex slugs by substring. Default: name, summary, and run/1 @spec per hit. detail: true only with an exact slug (not search).",
      shape: {
        query: z.string().min(1).describe("Non-empty substring filter"),
        limit: z.number().int().min(1).max(40).optional(),
        detail: z
          .boolean()
          .optional()
          .describe("Exact slug only: full moduledoc and specs for that entry"),
      },
      annotations: { readOnlyHint: true },
      run: ({ query, limit, detail }) =>
        codex({
          op: "find",
          query,
          ...(limit !== undefined ? { limit } : {}),
          ...(detail !== undefined ? { detail } : {}),
        }),
    },
    {
      name: HOST_TOOL_NAMES.define,
      description:
        "Persist a new Elixir codex entry on disk. Provide a complete AgentFn.<Name> defmodule with run/1, or only run/1.",
      shape: {
        name: z.string().describe("Codex slug: snake_case, dot namespaces allowed (e.g. pipeline.demo)"),
        source: z.string().describe("Elixir source for run/1 or a complete defmodule block"),
        description: z.string().optional().describe("Short summary stored for find_function"),
      },
      run: (args) => codex({ op: "define", ...args }),
    },
    {
      name: HOST_TOOL_NAMES.load,
      description: "Compile and load a defined Elixir codex entry into the running runtime.",
      shape: { name: z.string().describe("Function slug to load") },
      annotations: { idempotentHint: true },
      run: ({ name }) => codex({ op: "load", name }),
    },
    {
      name: HOST_TOOL_NAMES.call,
      description:
        "Invoke a codex entry's run/1 by slug with a JSON args object. Loads from disk when needed.",
      shape: {
        name: z.string().describe("Function slug to call"),
        args: z.record(z.string(), z.unknown()).optional().describe("JSON object passed to run/1"),
      },
      run: (input) => {
        const { name, args } = prepareCall ? prepareCall(input) : input;
        return callWithFlags(hostId, name, args);
      },
    },
    {
      name: HANDOFF_TOOL_NAME,
      description:
        "Write handoff.md for a new session. Call when the user asks to compact, or says the context footer is yellow or red. Then stop. Do not mention /new.",
      shape: {
        files: stringList(40, 240),
        systems: stringList(20, 120),
        pitfalls: stringList(12, 400),
        state: z.string().min(1).max(2_000),
        next: z.array(z.string().min(1).max(400)).min(1).max(12),
        facts: stringList(12, 400),
      },
      run: (input: HandoffInput) => runHandoff(hostId, input),
    },
  ];
}
