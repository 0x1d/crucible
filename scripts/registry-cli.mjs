#!/usr/bin/env node
/**
 * Host-agnostic CLI for the Elixir registry. Pipe JSON or pass as argv:
 *   node scripts/registry-cli.mjs '{"op":"find","query":""}'
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, "runtime");
const input = process.argv[2] ?? "";

const compile = spawnSync("mix", ["compile"], {
  cwd: runtimeDir,
  encoding: "utf-8",
  env: { ...process.env, MIX_ENV: "dev" },
});

if (compile.status !== 0) {
  console.error(compile.stderr || compile.stdout);
  process.exit(1);
}

const run = spawnSync(
  "mix",
  ["run", "--no-start", "-e", "Runtime.CLI.run_stdio()"],
  {
    cwd: runtimeDir,
    input: input.trim() ? input : "{}",
    encoding: "utf-8",
    env: {
      ...process.env,
      AGENT_FUNCTIONS_DIR: path.join(root, "functions"),
      MIX_ENV: "dev",
    },
  },
);

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
process.exit(run.status ?? 1);
