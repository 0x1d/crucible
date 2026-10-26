import assert from "node:assert/strict";
import test from "node:test";
import { calledTool, runEval } from "./run.ts";

const timeout = 300_000;

test("call-function invokes the bundled echo entry", { timeout }, async () => {
  const run = await runEval(
    'Use call-function with name "echo" and args {"msg":"hello"}. Reply with only the result map.',
  );
  assert.ok(calledTool(run, "call-function"), JSON.stringify(run.toolCalls));
  assert.match(run.text, /echoed/);
});

test("find-function lists codex entries", { timeout }, async () => {
  const run = await runEval("Which codex entries exist? List their slugs.");
  assert.ok(calledTool(run, "find-function"), JSON.stringify(run.toolCalls));
  assert.match(run.text, /echo/);
});
