import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runCodexTool } from "../lib/codex-tool";

export default defineTool({
  description:
    "Search codex slugs by substring. Returns name, one-line summary, and run/1 @spec per hit (not full moduledoc). Use a tight query (e.g. memory.overview). Skip when the slug is already known. With detail: true, query must be one exact slug (e.g. fs.read) — never combine detail with discovery search.",
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
      .describe(
        "When true, describe one entry: query must be the exact slug (moduledoc + specs). Not valid with substring search.",
      ),
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
