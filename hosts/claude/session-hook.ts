/**
 * PreToolUse hook: stamp the live Claude session id onto memory writes.
 *
 * The in-process MCP tools never see the session id, but SDK hooks do.
 * When the model calls `call_function` on `memory.remember` without a
 * session id, the hook adds `args.source_session`, so every remembered
 * entity can be found again with `memory.by_session`.
 */
import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

export const CALL_TOOL = "mcp__alchemist__call_function";
const STAMPED = new Set(["memory.remember"]);

type CallInput = { name?: unknown; args?: unknown };

/** Returns the rewritten tool input, or null when nothing should change. */
export function stampSession(
  toolInput: unknown,
  sessionId: string | undefined,
): Record<string, unknown> | null {
  if (!sessionId) return null;
  if (toolInput === null || typeof toolInput !== "object") return null;
  const input = toolInput as CallInput;
  if (typeof input.name !== "string" || !STAMPED.has(input.name)) return null;
  const args =
    input.args !== null && typeof input.args === "object" && !Array.isArray(input.args)
      ? (input.args as Record<string, unknown>)
      : {};
  const present = (v: unknown) => typeof v === "string" && v !== "";
  if (present(args.source_session) || present(args.session_id)) return null;
  return { ...input, args: { ...args, source_session: sessionId } };
}

async function hook(input: HookInput): Promise<HookJSONOutput> {
  if (input.hook_event_name !== "PreToolUse") return {};
  const updated = stampSession(input.tool_input, input.session_id);
  if (!updated) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      // The codex tools are already in allowedTools; allow keeps updatedInput applied.
      permissionDecision: "allow",
      updatedInput: updated,
    },
  };
}

export const sessionHooks: HookCallbackMatcher[] = [
  { matcher: CALL_TOOL, hooks: [hook] },
];
