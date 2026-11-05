import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { capToolResult } from "../lib/cap-tool-result.ts";
import { runCodexTool } from "../lib/codex-tool";

export default defineTool({
  description:
    "Persist a new Elixir tool on disk. Prefer @moduledoc and @spec on AgentFn.<Name> with @behaviour AgentFn.Tool. Provide a full defmodule or only run/1 (wrapper adds behaviour). Returns {:ok, map}, {:error, message}, or a plain map.",
  effect: "write",
  inputSchema: z.object({
    name: z
      .string()
      .describe(
        "Codex slug: snake_case, dot namespaces allowed (e.g. pipeline.demo, data.fetch)",
      ),
    source: z
      .string()
      .describe("Elixir source for run/1 or a complete defmodule block"),
    description: z
      .string()
      .optional()
      .describe("Short summary stored in the codex for find_function"),
  }),
  async execute({ name, source, description }, ctx) {
    const result = await runCodexTool({
      op: "define",
      name,
      source,
      description,
    });
    return capToolResult(result, ctx, "define_function");
  },
});
