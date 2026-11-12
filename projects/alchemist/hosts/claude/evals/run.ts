/** Shared eval runner: one query against the Claude host, tool calls recorded. */
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { stopRuntime } from "../../../core/elixir-bridge.ts";
import { alchemistOptions } from "../codex.ts";

// Evals always get their own BEAM and memory graph. ALCHEMIST_STATE_DIR is
// not trusted here: an eval started from a chat or TUI session inherits that
// session's value, and booting in it would stop the session's BEAM.
// Set ALCHEMIST_EVAL_STATE_DIR to pin the eval state directory.
const evalDir =
  process.env.ALCHEMIST_EVAL_STATE_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-eval-"));
fs.mkdirSync(evalDir, { recursive: true });
process.env.ALCHEMIST_STATE_DIR = evalDir;
process.env.AGENT_MEMORY_PATH = path.join(evalDir, "minigraf.graph");
after(() => stopRuntime());

export type EvalRun = {
  text: string;
  sessionId: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
};

export async function runEval(prompt: string): Promise<EvalRun> {
  const run: EvalRun = { text: "", sessionId: "", toolCalls: [] };
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
      run.sessionId = message.session_id;
      if (message.subtype !== "success") {
        throw new Error(`query ended with ${message.subtype}: ${message.errors.join("; ")}`);
      }
      run.text = message.result;
    }
  }
  return run;
}

export function calledTool(run: EvalRun, tool: string): boolean {
  return run.toolCalls.some((call) => call.name === `mcp__alchemist__${tool}`);
}
