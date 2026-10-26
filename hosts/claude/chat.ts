#!/usr/bin/env node
/**
 * Interactive Claude host for the Alchemist codex.
 *
 *   node hosts/claude/chat.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import readline from "node:readline/promises";
import { alchemistOptions } from "./codex.ts";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let sessionId: string | undefined;

for (;;) {
  const prompt = (await rl.question("you> ")).trim();
  if (prompt === "") continue;
  if (prompt === "exit") break;

  for await (const message of query({
    prompt,
    options: { ...alchemistOptions(), resume: sessionId },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.log(`[tool] ${block.name} ${JSON.stringify(block.input)}`);
        }
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
      console.log(message.subtype === "success" ? message.result : `[${message.subtype}]`);
    }
  }
}

rl.close();
