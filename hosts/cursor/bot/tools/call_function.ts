import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolExecuteResult } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runCodexTool } from "../lib/codex-tool";
import {
  DEFAULT_READ_HTTP_MAX_BYTES,
  effectiveContextImprovements,
} from "../lib/context-improvements.ts";
import { presentResult } from "../lib/result-digest";
import { logToolResultSize } from "../lib/tool-result-log.ts";

type CallContext = {
  toolCallId?: string;
  workspaceDir: string;
};

async function capResult(
  result: ToolExecuteResult,
  ctx: CallContext,
  slug: string,
): Promise<ToolExecuteResult> {
  const improvements = effectiveContextImprovements();
  logToolResultSize(slug, result, improvements.toolResultLog);
  if (!improvements.resultDigest) return result;
  const id =
    (ctx.toolCallId ?? "result").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) ||
    "result";
  const saved = path.join(ctx.workspaceDir, "artifacts", id + ".json");
  const presented = presentResult(result, saved);
  if (!presented.replace) return result;
  await mkdir(path.dirname(saved), { recursive: true });
  await writeFile(saved, presented.text);
  return presented.value;
}

export default defineTool({
  description:
    "Invoke a codex entry's run/1 by slug with a JSON args object. Loads from disk when needed.",
  effect: "write",
  inputSchema: z.object({
    name: z.string().describe("Function slug to call"),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("JSON object passed to run/1"),
  }),
  async execute({ name, args }, ctx) {
    let callArgs = args ?? {};
    const improvements = effectiveContextImprovements();
    if (
      improvements.defaultMaxBytes &&
      (name === "fs.read" || name === "http.get") &&
      (callArgs as Record<string, unknown>).max_bytes === undefined
    ) {
      callArgs = { ...callArgs, max_bytes: DEFAULT_READ_HTTP_MAX_BYTES };
    }
    const result = await runCodexTool({ op: "call", name, args: callArgs });
    return capResult(result, ctx, name);
  },
});
