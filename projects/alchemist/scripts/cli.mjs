#!/usr/bin/env node
/**
 * Host-agnostic CLI for the Elixir codex. Reuses the long-lived BEAM
 * started by core/elixir-bridge.ts.
 *
 *   node scripts/cli.mjs '{"op":"find","query":""}'
 */
import { runCodexOp } from "../core/elixir-bridge.ts";

const input = process.argv[2] ?? "{}";

let request;
try {
  request = JSON.parse(input.trim() ? input : "{}");
} catch {
  console.error("invalid JSON");
  process.exit(1);
}

const result = await runCodexOp(request);
process.stdout.write(`${JSON.stringify(result)}\n`);
