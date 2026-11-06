import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { capToolResult } from "../lib/cap-tool-result.ts";
import { runCodexTool } from "../lib/codex-tool.ts";
import { exploreGateBlocked } from "../lib/explore-gate.ts";
import {
  DEFAULT_READ_HTTP_MAX_BYTES,
  loadMemoryExploreSettings,
  resolveHostFlags,
} from "../lib/host-flags.ts";

export default defineTool({
  description:
    "Invoke a codex entry's run/1. Input: name (function slug string) and optional args object.",
  effect: "write",
  inputSchema: z.object({
    name: z.string().describe("Function slug to call"),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("JSON object passed to run/1"),
  }),
  async execute({ name, args }, ctx) {
    const exploreSettings = loadMemoryExploreSettings();
    const blocked = exploreGateBlocked(
      name,
      ctx.workspaceDir,
      exploreSettings.requireExploreBeforeProbe,
    );
    if (blocked) return blocked;

    let callArgs = args ?? {};
    const flags = resolveHostFlags();
    if (
      flags.defaultMaxBytes &&
      (name === "fs.read" || name === "http.get") &&
      (callArgs as Record<string, unknown>).max_bytes === undefined
    ) {
      callArgs = { ...callArgs, max_bytes: DEFAULT_READ_HTTP_MAX_BYTES };
    }
    const result = await runCodexTool({ op: "call", name, args: callArgs });
    return capToolResult(result, ctx, name);
  },
});
