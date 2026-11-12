import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

import type { HookContext } from "@grok/agent-sdk";

import { loadMemoryExploreSettings } from "./host-flags.ts";

export function autoMemoryRetainTurnKey(sessionId: string): string {
  return `auto-memory-retain/turns/${sessionId}`;
}

export function sessionEventsPath(stateRoot: string, sessionId: string): string {
  return path.join(stateRoot, "sessions", sessionId, "events.ndjson");
}

/** Count persisted `turn.completed` events (matches TUI replay `done` count). */
export async function countCompletedTurns(
  stateRoot: string,
  sessionId: string,
): Promise<number> {
  const file = sessionEventsPath(stateRoot, sessionId);
  if (!existsSync(file)) return 0;

  let count = 0;
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }) });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: string };
      if (event.type === "turn.completed") count += 1;
    } catch {
      /* ignore corrupt lines */
    }
  }
  return count;
}

/**
 * Align the HTTP auto-retain counter with the session event log after resume
 * (parity with TUI `completedTurns` seed on `openSession`).
 */
export async function seedAutoRetainTurnCounter(ctx: HookContext): Promise<void> {
  const settings = loadMemoryExploreSettings(ctx.stateRoot, "cursor");
  if (!settings.memoryAutoRetain || settings.memoryRetainEveryTurns < 1) return;

  const key = autoMemoryRetainTurnKey(ctx.session.id);
  const fromLog = await countCompletedTurns(ctx.stateRoot, ctx.session.id);
  const prev = await ctx.host.kv.get(key);

  if (typeof prev === "number") {
    if (fromLog > prev) await ctx.host.kv.put(key, fromLog);
    return;
  }
  if (fromLog > 0) await ctx.host.kv.put(key, fromLog);
}
