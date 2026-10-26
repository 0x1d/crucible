/** Shared eval runner: one query against the Claude host, tool calls recorded. */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { alchemistOptions } from "../codex.ts";

export type EvalRun = {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
};

export async function runEval(prompt: string): Promise<EvalRun> {
  const run: EvalRun = { text: "", toolCalls: [] };
  for await (const message of query({
    prompt,
    options: { ...alchemistOptions(), maxTurns: 8 },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          run.toolCalls.push({
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }
    } else if (message.type === "result") {
      if (message.subtype !== "success") throw new Error(`query ended with ${message.subtype}`);
      run.text = message.result;
    }
  }
  return run;
}

export function calledTool(run: EvalRun, tool: string): boolean {
  return run.toolCalls.some((call) => call.name === `mcp__alchemist__${tool}`);
}
