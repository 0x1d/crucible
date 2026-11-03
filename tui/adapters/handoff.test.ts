import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FORK_ABOVE_TOKENS,
  HANDOFF_REQUEST,
  isHandoffSuccess,
  readChain,
  recordFork,
  resolveSuccessor,
  routeTurn,
  seedMessage,
  writeChain,
} from "./handoff.ts";

test("route table rows", () => {
  const base = {
    lastContextTokens: 1000,
    handoffFilePresent: true,
    userText: "hello",
  };
  assert.deepEqual(routeTurn({ ...base, hasSession: false, pendingHandoff: false }), {
    kind: "create",
    message: "hello",
  });
  assert.deepEqual(routeTurn({ ...base, hasSession: true, pendingHandoff: false }), {
    kind: "follow-up",
    message: "hello",
  });
  assert.deepEqual(routeTurn({ ...base, hasSession: true, pendingHandoff: true }), {
    kind: "fork",
    userText: "hello",
    file: "",
  });
  assert.equal(
    routeTurn({ ...base, hasSession: true, pendingHandoff: true, handoffFilePresent: false }).kind,
    "error",
  );
  assert.deepEqual(
    routeTurn({
      ...base,
      hasSession: true,
      pendingHandoff: false,
      lastContextTokens: FORK_ABOVE_TOKENS + 1,
    }),
    { kind: "compact-then-fork", userText: "hello" },
  );
  assert.deepEqual(
    routeTurn({
      ...base,
      hasSession: true,
      pendingHandoff: true,
      lastContextTokens: FORK_ABOVE_TOKENS + 1,
    }),
    { kind: "fork", userText: "hello", file: "" },
  );
});

test("HANDOFF_REQUEST does not contain user text", () => {
  assert.doesNotMatch(HANDOFF_REQUEST, /hello/);
});

test("seedMessage format", () => {
  assert.equal(seedMessage("file body", "user"), seedMessage("file body", "user"));
});

test("isHandoffSuccess matches action.result", () => {
  assert.equal(
    isHandoffSuccess({ type: "action.result", data: { toolName: "handoff", isError: false } }),
    true,
  );
  assert.equal(
    isHandoffSuccess({ type: "action.result", data: { toolName: "handoff", isError: true } }),
    false,
  );
  assert.equal(
    isHandoffSuccess({ type: "action.result", data: { toolName: "handoff", stubbed: true } }),
    false,
  );
});

test("resolveSuccessor walks the chain", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "handoff-chain-"));
  try {
    writeChain(root, { a: "b", b: "c" });
    assert.deepEqual(readChain(root), { a: "b", b: "c" });
    recordFork(root, "c", "d");
    assert.equal(resolveSuccessor(root, "a"), "d");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
