#!/usr/bin/env node
/**
 * Measure call_function output size for fs.read (context digest A/B).
 * Usage: nix develop -- node scripts/measure-call-function.mjs [path]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payload =
  process.argv[2] ?? "/tmp/alchemist-ctx-eval/payload.txt";
const input = JSON.stringify({ name: "fs.read", args: { path: payload } });
const agentSdk = path.join(repoRoot, "node_modules/.bin/agent-sdk");

const child = spawnSync(
  agentSdk,
  ["tool", "call", "call_function", "--dir", path.join(repoRoot, "hosts/cursor"), "--json", "--input", input],
  { cwd: repoRoot, env: process.env, encoding: "utf8" },
);
if (child.status !== 0) {
  console.error(child.stderr || child.stdout);
  process.exit(child.status ?? 1);
}
const parsed = JSON.parse(child.stdout);
const text = JSON.stringify(parsed.result ?? parsed);
console.log(JSON.stringify({ bytes: Buffer.byteLength(text), ok: parsed.ok !== false }, null, 2));
