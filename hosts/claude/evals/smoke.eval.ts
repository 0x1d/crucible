import assert from "node:assert/strict";
import test from "node:test";
import { calledTool, runEval } from "./run.ts";

const timeout = 300_000;

test("call_function invokes the bundled echo entry", { timeout }, async () => {
  const run = await runEval(
    'Use call_function with name "echo" and args {"msg":"hello"}. Reply with only the result map.',
  );
  assert.ok(calledTool(run, "call_function"), JSON.stringify(run.toolCalls));
  assert.match(run.text, /echoed/);
});

test("find_function lists codex entries", { timeout }, async () => {
  const run = await runEval("Which codex entries exist? List their slugs.");
  assert.ok(calledTool(run, "find_function"), JSON.stringify(run.toolCalls));
  assert.match(run.text, /echo/);
});
