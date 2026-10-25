/**
 * Host-agnostic registry operations. Any agent host (Cursor BDK, OpenCode,
 * Claude Code, a Go wrapper) can forward these four ops to Runtime.Server.
 */
export const REGISTRY_OPS = ["define", "load", "find", "call"] as const;

export type RegistryOp = (typeof REGISTRY_OPS)[number];

export type RegistryRequest =
  | { op: "define"; name: string; source: string; description?: string }
  | { op: "load"; name: string }
  | { op: "find"; query?: string }
  | { op: "call"; name: string; args?: Record<string, unknown> };

/** Model-facing names when the host exposes JSON tools (kebab-case). */
export const HOST_TOOL_NAMES = {
  define: "define-function",
  load: "load-function",
  find: "find-function",
  call: "call-function",
} as const;
