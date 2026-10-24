import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runElixirOp } from "../lib/elixir-bridge";

export default defineTool({
  description:
    "Compile and load a previously defined Elixir function from disk into the running runtime.",
  effect: "idempotent",
  inputSchema: z.object({
    name: z.string().describe("Function slug to load"),
  }),
  async execute({ name }) {
    return runElixirOp({ op: "load", name });
  },
});
