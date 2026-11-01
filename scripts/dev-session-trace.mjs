#!/usr/bin/env node
/**
 * Seed session_trace memory, then start playground with that graph.
 *
 *   npm run dev:session-trace
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  seedSessionTraceMemory,
  sessionTraceMemoryPath,
} from "../hosts/cursor/evals/lib/session-trace-memory.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(repoRoot, "hosts/cursor");
const agentSdk = path.join(repoRoot, "node_modules/.bin/agent-sdk");

const seeded = await seedSessionTraceMemory({
  memoryPath: sessionTraceMemoryPath,
});
process.stderr.write(`session_trace memory: ${seeded.path}\n`);

const child = spawn(
  agentSdk,
  ["dev", "--dir", agentDir],
  {
    cwd: repoRoot,
    env: { ...process.env, AGENT_MEMORY_PATH: sessionTraceMemoryPath },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
