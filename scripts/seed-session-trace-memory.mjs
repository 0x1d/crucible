#!/usr/bin/env node
/**
 * Reset AGENT_MEMORY_PATH and apply session_trace eval fixture transactions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodexOp, stopRuntime } from "../core/elixir-bridge.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  repoRoot,
  "hosts/cursor/evals/fixtures/session-trace-seed.json",
);

const memoryPath = process.env.AGENT_MEMORY_PATH;
if (!memoryPath) {
  console.error("AGENT_MEMORY_PATH is required");
  process.exit(2);
}

const resolved = path.resolve(memoryPath);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

await stopRuntime();
for (const suffix of ["", ".tx"]) {
  try {
    fs.unlinkSync(`${resolved}${suffix}`);
  } catch {
    // fresh path
  }
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
for (const tx of fixture.transactions) {
  const result = await runCodexOp({
    op: "call",
    name: "memory.transact",
    args: { reason: tx.reason, facts: tx.facts },
  });
  if (result?.ok === false) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: true, path: resolved, count: fixture.transactions.length })}\n`,
);
