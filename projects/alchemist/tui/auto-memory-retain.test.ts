import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MEMORY_EXPLORE_SETTINGS } from "../hosts/cursor/bot/lib/host-flags.ts";
import { shouldAutoRetain } from "./auto-memory-retain.ts";

test("shouldAutoRetain respects interval", () => {
  const on = { ...DEFAULT_MEMORY_EXPLORE_SETTINGS, memoryAutoRetain: true, memoryRetainEveryTurns: 3 };
  assert.equal(shouldAutoRetain(1, on), false);
  assert.equal(shouldAutoRetain(3, on), true);
  assert.equal(shouldAutoRetain(6, on), true);
  assert.equal(shouldAutoRetain(3, DEFAULT_MEMORY_EXPLORE_SETTINGS), false);
});
