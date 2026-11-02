import assert from "node:assert/strict";
import test from "node:test";
import { sessionHooks, stampSession } from "./session-hook.ts";

const remember = {
  name: "memory.remember",
  args: { reason: "r", facts: [{ e: "decision/a", a: "description", v: "x" }] },
};

test("stamps source_session onto memory.remember", () => {
  assert.deepEqual(stampSession(remember, "s1"), {
    ...remember,
    args: { ...remember.args, source_session: "s1" },
  });
});

test("keeps an explicit session id", () => {
  assert.equal(stampSession({ ...remember, args: { ...remember.args, source_session: "mine" } }, "s1"), null);
  assert.equal(stampSession({ ...remember, args: { ...remember.args, session_id: "mine" } }, "s1"), null);
});

test("ignores other entries and missing session ids", () => {
  assert.equal(stampSession({ name: "memory.query", args: {} }, "s1"), null);
  assert.equal(stampSession({ name: "memory.transact", args: {} }, "s1"), null);
  assert.equal(stampSession(remember, undefined), null);
  assert.equal(stampSession("nope", "s1"), null);
});

test("hook returns updatedInput for PreToolUse", async () => {
  const [matcher] = sessionHooks;
  assert.equal(matcher.matcher, "mcp__alchemist__call_function");
  const out = await matcher.hooks[0](
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      transcript_path: "",
      cwd: "",
      tool_name: "mcp__alchemist__call_function",
      tool_input: remember,
      tool_use_id: "t1",
    } as never,
    "t1",
    { signal: new AbortController().signal } as never,
  );
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...remember, args: { ...remember.args, source_session: "s1" } },
    },
  });
});
