#!/usr/bin/env node
/**
 * Stop orphan Alchemist BEAM VMs and clear stale bridge state.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopRuntime } from "../core/elixir-bridge.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "Application.ensure_all_started(:runtime";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!alive(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  return true;
}

function killOrphans() {
  const killed = [];
  let entries;
  try {
    entries = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return killed;
  }
  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let cmd = "";
    try {
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (!cmd.includes(marker)) continue;
    if (killPid(pid)) killed.push(pid);
  }
  return killed;
}

await stopRuntime();
const killed = killOrphans();
if (killed.length > 0) {
  await new Promise((r) => setTimeout(r, 500));
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    stopped: killed,
    hint:
      killed.length > 0
        ? "retry your codex call"
        : "no orphan runtime processes found",
  })}\n`,
);
