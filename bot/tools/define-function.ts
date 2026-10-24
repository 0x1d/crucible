import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { runElixirOp } from "../lib/elixir-bridge";

export default defineTool({
  description:
    "Persist a new Elixir tool on disk. Provide either a full defmodule or just a run/1 body. Every tool must implement run(args) returning {:ok, map}, {:error, message}, or a plain map.",
  effect: "write",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Slug name, e.g. greet_user or fetch_weather"),
    source: z
      .string()
      .describe("Elixir source for run/1 or a complete defmodule block"),
    description: z
      .string()
      .optional()
      .describe("Short summary stored in the registry for find-function"),
  }),
  async execute({ name, source, description }) {
    return runElixirOp({
      op: "define",
      name,
      source,
      description,
    });
  },
});
