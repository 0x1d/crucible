import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runCodexTool } from "../lib/codex-tool";

export default defineTool({
  description:
    "Search codex slugs by substring. Returns name and one-line summary per hit (not full docs). Use a tight query (e.g. memory.overview). Skip when the slug is already known.",
  effect: "read",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("Non-empty substring matched against slug and metadata"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(40)
      .optional()
      .describe("Max hits (default 12)"),
    detail: z
      .boolean()
      .optional()
      .describe("When true, return full moduledoc and specs per hit"),
  }),
  async execute({ query, limit, detail }) {
    return runCodexTool({
      op: "find",
      query,
      ...(limit !== undefined ? { limit } : {}),
      ...(detail !== undefined ? { detail } : {}),
    });
  },
});
