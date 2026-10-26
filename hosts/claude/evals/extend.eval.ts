import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { repoRoot } from "../codex.ts";
import { calledTool, runEval } from "./run.ts";

const slug = "scratch.claude_eval";
const entryDir = path.join(repoRoot, "functions", "scratch", "claude_eval");

test("define-function extends the codex and call-function runs the new entry", { timeout: 300_000 }, async () => {
  const run = await runEval(
    `Define a codex entry with slug "${slug}" whose run/1 returns {:ok, %{"sum" => a + b}} for integer args "a" and "b". Then call it with a=2 and b=3 and reply with only the result map.`,
  );
  assert.ok(calledTool(run, "define-function"), JSON.stringify(run.toolCalls));
  assert.ok(calledTool(run, "call-function"), JSON.stringify(run.toolCalls));
  assert.match(run.text, /5/);
  assert.ok(fs.existsSync(path.join(entryDir, "tool.ex")));
});

test.after(() => {
  fs.rmSync(entryDir, { recursive: true, force: true });
  const parent = path.dirname(entryDir);
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
});
