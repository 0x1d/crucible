/**
 * Host-agnostic codex operations. Any agent host (Cursor BDK, OpenCode,
 * Claude Code, a Go wrapper) can forward these four ops to Runtime.Server.
 */
export const CODEX_OPS = ["define", "load", "find", "call"] as const;

export type CodexOp = (typeof CODEX_OPS)[number];

export type CodexRequest =
  | { op: "define"; name: string; source: string; description?: string }
  | { op: "load"; name: string }
  | {
      op: "find";
      query?: string;
      limit?: number;
      /** Exact slug describe only; not combined with substring search. */
      detail?: boolean;
    }
  | { op: "call"; name: string; args?: Record<string, unknown> };

/** Model-facing names when the host exposes JSON tools (snake_case). */
export const HOST_TOOL_NAMES = {
  define: "define_function",
  load: "load_function",
  find: "find_function",
  call: "call_function",
} as const;
