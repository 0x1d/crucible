#!/usr/bin/env node
/**
 * Host-agnostic CLI for the Elixir registry. Reuses the long-lived BEAM
 * started by core/elixir-bridge.ts.
 *
 *   node scripts/registry-cli.mjs '{"op":"find","query":""}'
 */
import { runRegistryOp } from "../core/elixir-bridge.ts";

const input = process.argv[2] ?? "{}";

let request;
try {
  request = JSON.parse(input.trim() ? input : "{}");
} catch {
  console.error("invalid JSON");
  process.exit(1);
}

const result = await runRegistryOp(request);
process.stdout.write(`${JSON.stringify(result)}\n`);
