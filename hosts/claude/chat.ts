#!/usr/bin/env node
/**
 * Interactive Alchemist host on the Claude Agent SDK.
 *
 *   node hosts/claude/chat.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import readline from "node:readline/promises";
import { alchemistOptions } from "./codex.ts";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let sessionId: string | undefined;

rl.setPrompt("you> ");
rl.prompt();

for await (const line of rl) {
  const prompt = line.trim();
  if (prompt === "exit") break;
  if (prompt !== "") {
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
        if (message.subtype === "success") {
          console.log(message.result);
        } else {
          console.error(`[${message.subtype}] ${message.errors.join("\n")}`);
        }
      }
    }
  }
  rl.prompt();
}

rl.close();
