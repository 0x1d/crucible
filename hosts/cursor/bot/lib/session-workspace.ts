import path from "node:path";
import { fileURLToPath } from "node:url";

const botDir = path.dirname(fileURLToPath(import.meta.url));
/** Cursor host root (`hosts/cursor`), parent of `bot/`. */
export const cursorHostRoot = path.resolve(botDir, "../..");

/**
 * Harness cwd for a session when `agent.local.cwd` is `.sessions` under the host.
 * Must match {@link ToolContext.workspaceDir} for explore-gate Map keys.
 */
export function sessionHarnessDir(stateRoot: string, sessionId: string): string {
  const hostRoot = path.dirname(stateRoot);
  return path.join(hostRoot, ".sessions", sessionId);
}
