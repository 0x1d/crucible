import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { capToolResult } from "../lib/cap-tool-result.ts";
import { runCodexTool } from "../lib/codex-tool";

export default defineTool({
  description: "Compile and load a codex entry from disk.",
  effect: "idempotent",
  inputSchema: z.object({
    name: z.string().describe("Function slug to load"),
  }),
  async execute({ name }, ctx) {
    const result = await runCodexTool({ op: "load", name });
    return capToolResult(result, ctx, "load_function");
  },
});
