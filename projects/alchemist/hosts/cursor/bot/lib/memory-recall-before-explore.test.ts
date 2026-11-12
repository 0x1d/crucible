import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMemoryRecallAppend,
  isNamedPathReadTurn,
} from "./memory-recall-before-explore.ts";

test("isNamedPathReadTurn detects read path prompts", () => {
  assert.equal(isNamedPathReadTurn("read docs/plan.md"), true);
  assert.equal(isNamedPathReadTurn("read  ../foo/bar.ts"), true);
  assert.equal(isNamedPathReadTurn("what is in memory?"), false);
  assert.equal(isNamedPathReadTurn("read the codebase"), false);
});

test("formatMemoryRecallAppend wraps entities", () => {
  const block = formatMemoryRecallAppend([
    { id: "decision/x", description: "Keep defaults false" },
  ]);
  assert.match(block, /\[memory-recall\]/);
  assert.match(block, /decision\/x/);
});
