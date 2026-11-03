import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  FORK_ABOVE_TOKENS,
  HANDOFF_REQUEST,
  HANDOFF_PREAMBLE,
  seedMessage,
} from "../../hosts/cursor/bot/lib/handoff.ts";

export { FORK_ABOVE_TOKENS, HANDOFF_REQUEST, HANDOFF_PREAMBLE, seedMessage };

export type TurnRoute =
  | { kind: "create"; message: string }
  | { kind: "follow-up"; message: string }
  | { kind: "compact-then-fork"; userText: string }
  | { kind: "fork"; userText: string; file: string }
  | { kind: "error"; message: string };

export type RouteInput = {
  hasSession: boolean;
  lastContextTokens: number;
  pendingHandoff: boolean;
  handoffFilePresent: boolean;
  userText: string;
};

export function routeTurn(input: RouteInput): TurnRoute {
  const { hasSession, lastContextTokens, pendingHandoff, handoffFilePresent, userText } = input;
  if (!hasSession) return { kind: "create", message: userText };
  const over = lastContextTokens > FORK_ABOVE_TOKENS;
  if (!over && !pendingHandoff) return { kind: "follow-up", message: userText };
  if (!over && pendingHandoff) {
    if (handoffFilePresent) return { kind: "fork", userText, file: "" };
    return { kind: "error", message: "Handoff file is missing. Write handoff.md before continuing." };
  }
  if (over && !pendingHandoff) return { kind: "compact-then-fork", userText };
  if (handoffFilePresent) return { kind: "fork", userText, file: "" };
  return { kind: "error", message: "Handoff file is missing. Write handoff.md before continuing." };
}

/** Raw Cursor `action.result` for the handoff tool. */
export type HandoffResultEvent = {
  type?: string;
  data?: {
    toolName?: string;
    isError?: boolean;
    stubbed?: boolean;
    output?: unknown;
  };
};

export function isHandoffSuccess(raw: unknown): boolean {
  const event = raw as HandoffResultEvent;
  if (event.type !== "action.result") return false;
  const data = event.data ?? {};
  if (data.toolName !== "handoff") return false;
  if (data.isError === true || data.stubbed === true) return false;
  return true;
}

export type HandoffChain = Record<string, string>;

export function chainPath(stateRoot: string): string {
  return path.join(stateRoot, "handoff-chain.json");
}

export function readChain(stateRoot: string): HandoffChain {
  const file = chainPath(stateRoot);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: HandoffChain = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeChain(stateRoot: string, chain: HandoffChain): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(chainPath(stateRoot), `${JSON.stringify(chain, null, 2)}\n`, "utf8");
}

export function recordFork(stateRoot: string, oldId: string, newId: string): void {
  const chain = readChain(stateRoot);
  chain[oldId] = newId;
  writeChain(stateRoot, chain);
}

export function resolveSuccessor(stateRoot: string, sessionId: string): string {
  const chain = readChain(stateRoot);
  let current = sessionId;
  for (let step = 0; step < 20; step++) {
    const next = chain[current];
    if (!next) return current;
    current = next;
  }
  return current;
}

export function hiddenSessionIds(stateRoot: string): Set<string> {
  return new Set(Object.keys(readChain(stateRoot)));
}

export function handoffFilePath(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, sessionId, "handoff.md");
}

export function readHandoffFile(sessionsDir: string, sessionId: string): string | undefined {
  const file = handoffFilePath(sessionsDir, sessionId);
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8");
}

export function handoffFileExists(sessionsDir: string, sessionId: string): boolean {
  return existsSync(handoffFilePath(sessionsDir, sessionId));
}

/** Adjust fork route once the file text is loaded. */
export function withHandoffFile(route: TurnRoute, file: string): TurnRoute {
  if (route.kind !== "fork") return route;
  return { ...route, file };
}
