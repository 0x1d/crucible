import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolExecuteResult } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";

import { effectiveContextImprovements } from "../lib/context-improvements.ts";
import { renderHandoff } from "../lib/handoff.ts";

const stringList = (max: number, maxLen: number) =>
  z.array(z.string().min(1).max(maxLen)).max(max).optional();

export default defineTool({
  description:
    "Write handoff.md for a new session. Call when the user asks to compact, or says the context footer is yellow or red. Then stop. Do not mention /new.",
  effect: "write",
  inputSchema: z
    .object({
      files: stringList(40, 240),
      systems: stringList(20, 120),
      pitfalls: stringList(12, 400),
      state: z.string().min(1).max(2_000),
      next: z.array(z.string().min(1).max(400)).min(1).max(12),
      facts: stringList(12, 400),
    })
    .strict(),
  dryRunResult(input) {
    const text = renderHandoff(input);
    const bytes = Buffer.byteLength(text, "utf8");
    return {
      path: "handoff.md",
      bytes,
      confirmation: "Dry run. handoff.md was not written.",
    };
  },
  async execute(input, ctx): Promise<ToolExecuteResult> {
    if (!effectiveContextImprovements().handoffTool) {
      return {
        content: [{ type: "text", text: "The handoff tool is disabled. Enable handoffTool in context improvements." }],
        isError: true,
      };
    }
    const text = renderHandoff(input);
    const bytes = Buffer.byteLength(text, "utf8");
    const filePath = "handoff.md";
    await writeFile(path.join(ctx.workspaceDir, filePath), text, "utf8");
    if (ctx.session?.id) {
      await ctx.host.kv.put("handoff/" + ctx.session.id, { path: filePath, bytes });
    }
    return {
      path: filePath,
      bytes,
      confirmation: "Wrote handoff.md (" + String(bytes) + " bytes).",
    };
  },
});
