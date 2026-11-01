import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runCodexTool } from "../lib/codex-tool";

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
  async execute({ name, args }) {
    return runCodexTool({ op: "call", name, args: args ?? {} });
  },
});
