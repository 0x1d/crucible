/**
 * Shared session_trace MiniGraf seed for evals and playground.
 * Default graph: hosts/cursor/.eval-memory/session-trace.graph
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodexOp, stopRuntime } from "../../../../core/elixir-bridge.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export const cursorHostRoot = path.resolve(here, "../..");

/** Default graph for session_trace evals and `npm run dev:session-trace`. */
export const sessionTraceMemoryPath = path.join(
  cursorHostRoot,
  ".eval-memory",
  "session-trace.graph",
);

export const sessionTraceFixturePath = path.join(
  here,
  "..",
  "fixtures",
  "session-trace-seed.json",
);

type SeedFixture = {
  transactions: Array<{ reason: string; facts: unknown[] }>;
};

/**
 * Wipe the session_trace graph and apply the committed fixture.
 * Sets `AGENT_MEMORY_PATH` so the next BEAM open uses that file.
 */
export async function seedSessionTraceMemory(options?: {
  memoryPath?: string;
}): Promise<{ path: string; count: number }> {
  const resolved = path.resolve(options?.memoryPath ?? sessionTraceMemoryPath);
  process.env.AGENT_MEMORY_PATH = resolved;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  await stopRuntime();
  for (const suffix of ["", ".tx"]) {
    try {
      fs.unlinkSync(`${resolved}${suffix}`);
    } catch {
      // fresh path
    }
  }

  const fixture = JSON.parse(
    fs.readFileSync(sessionTraceFixturePath, "utf8"),
  ) as SeedFixture;
  for (const tx of fixture.transactions) {
    const result = await runCodexOp({
      op: "call",
      name: "memory.transact",
      args: { reason: tx.reason, facts: tx.facts },
    });
    if (result?.ok === false) {
      throw new Error(`session_trace seed failed: ${JSON.stringify(result)}`);
    }
  }

  return { path: resolved, count: fixture.transactions.length };
}
