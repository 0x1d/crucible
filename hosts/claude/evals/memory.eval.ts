import assert from "node:assert/strict";
import test from "node:test";
import { runCodexOp } from "../../../core/elixir-bridge.ts";
import { runEval } from "./run.ts";

type CallInput = { name?: string; args?: Record<string, unknown> };

test("memory.remember is stamped with the live session id", { timeout: 300_000 }, async () => {
  const run = await runEval(
    'Remember with memory.remember: entity "decision/eval_db" has description "Use PostgreSQL for evals." Reply with "done".',
  );
  assert.notEqual(run.sessionId, "");

  const remember = run.toolCalls
    .map((call) => call.input as CallInput)
    .find((input) => input.name === "memory.remember");
  assert.ok(remember, JSON.stringify(run.toolCalls));
  // The model's own input carries no session id; the PreToolUse hook adds it.
  assert.equal(remember.args?.source_session, undefined);

  const found = (await runCodexOp({
    op: "call",
    name: "memory.by_session",
    args: { session_id: run.sessionId },
  })) as { ok?: boolean; result?: { entities?: string[] } };
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.deepEqual(found.result?.entities, ["decision/eval_db"], JSON.stringify(found));
});
