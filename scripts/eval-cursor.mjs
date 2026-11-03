#!/usr/bin/env node
/**
 * Run the Cursor host evals with their own BEAM and memory graph.
 *
 *   npm run eval:cursor                 # all cases
 *   npm run eval:cursor -- memory       # one file or case, any agent-sdk eval flags
 *
 * An inherited ALCHEMIST_STATE_DIR (e.g. from a chat or TUI session) would make
 * the eval stop that session's BEAM, and the repo memory graph must not
 * collect eval facts. Set ALCHEMIST_EVAL_STATE_DIR to pin the state folder.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentSdk = path.join(repoRoot, "node_modules/.bin/agent-sdk");

/** Spawn `agent-sdk eval --dir hosts/cursor ...args` in an isolated runtime. */
export function runCursorEvals(args, env = {}) {
  const stateDir =
    process.env.ALCHEMIST_EVAL_STATE_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-eval-"));
  fs.mkdirSync(stateDir, { recursive: true });
  const child = spawn(agentSdk, ["eval", "--dir", path.join(repoRoot, "hosts/cursor"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ALCHEMIST_STATE_DIR: stateDir,
      AGENT_MEMORY_PATH: path.join(stateDir, "minigraf.graph"),
      ...env,
    },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCursorEvals(process.argv.slice(2));
}
