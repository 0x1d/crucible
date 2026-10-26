import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runCodexOp } from "../lib/elixir-bridge";

export default defineTool({
  description:
    "Invoke a loaded Elixir function by name. Loads from disk automatically if needed.",
  effect: "idempotent",
  inputSchema: z.object({
    name: z.string().describe("Function slug to call"),
    args: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("JSON object passed to run/1"),
  }),
  async execute({ name, args }) {
    return runCodexOp({ op: "call", name, args });
  },
});
