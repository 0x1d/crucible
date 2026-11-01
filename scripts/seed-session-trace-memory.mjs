#!/usr/bin/env node
/**
 * Reset the session_trace MiniGraf graph and apply the eval fixture.
 *
 *   node --experimental-strip-types scripts/seed-session-trace-memory.mjs
 *   node --experimental-strip-types scripts/seed-session-trace-memory.mjs /tmp/custom.graph
 *
 * Default path: hosts/cursor/.eval-memory/session-trace.graph
 * Pass an explicit path (measure trials) to override; do not rely on a stale env var.
 */
import {
  seedSessionTraceMemory,
  sessionTraceMemoryPath,
} from "../hosts/cursor/evals/lib/session-trace-memory.ts";

const memoryPath = process.argv[2] ?? sessionTraceMemoryPath;
const result = await seedSessionTraceMemory({ memoryPath });
process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
