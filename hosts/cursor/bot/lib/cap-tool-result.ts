import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolExecuteResult } from "@grok/agent-sdk";

import { resolveHostFlags } from "./host-flags.ts";
import { presentResult } from "./result-digest.ts";
import { logToolResultSize } from "./tool-result-log.ts";

export type CapToolContext = {
  toolCallId?: string;
  workspaceDir: string;
};

export async function capToolResult(
  result: ToolExecuteResult,
  ctx: CapToolContext,
  toolLabel: string,
): Promise<ToolExecuteResult> {
  const flags = resolveHostFlags();
  logToolResultSize(toolLabel, result, flags.toolResultLog);
  if (!flags.resultDigest) return result;
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
