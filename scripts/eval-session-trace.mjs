#!/usr/bin/env node
/**
 * Run session_trace evals against the shared eval MiniGraf path.
 *
 *   npm run eval:session-trace
 *   node scripts/eval-session-trace.mjs factory-qna
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionTraceMemoryPath } from "../hosts/cursor/evals/lib/session-trace-memory.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(repoRoot, "hosts/cursor");
const agentSdk = path.join(repoRoot, "node_modules/.bin/agent-sdk");
const selector = process.argv[2] ?? "--tag";
const rest =
  selector === "--tag"
    ? ["--tag", "session-trace", ...process.argv.slice(3)]
    : [selector.startsWith("session_trace") ? selector : `session_trace/${selector}`, ...process.argv.slice(3)];

const child = spawn(
  agentSdk,
  ["eval", "--dir", agentDir, ...rest],
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
