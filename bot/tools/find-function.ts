import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runRegistryOp } from "../lib/elixir-bridge";

export default defineTool({
  description:
    "Search the on-disk registry of Elixir functions by name, module, or description.",
  effect: "read",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Case-insensitive substring filter; omit to list all"),
  }),
  async execute({ query }) {
    return runRegistryOp({ op: "find", query: query ?? "" });
  },
});
