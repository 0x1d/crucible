#!/usr/bin/env node
/**
 * Run session_trace evals against the shared eval MiniGraf path.
 *
 *   npm run eval:session-trace
 *   node scripts/eval-session-trace.mjs factory-qna
 */
import { sessionTraceMemoryPath } from "../hosts/cursor/evals/lib/session-trace-memory.ts";
import { runCursorEvals } from "./eval-cursor.mjs";

const selector = process.argv[2] ?? "--tag";
const rest =
  selector === "--tag"
    ? ["--tag", "session-trace", ...process.argv.slice(3)]
    : [selector.startsWith("session_trace") ? selector : `session_trace/${selector}`, ...process.argv.slice(3)];

runCursorEvals(rest, { AGENT_MEMORY_PATH: sessionTraceMemoryPath });
