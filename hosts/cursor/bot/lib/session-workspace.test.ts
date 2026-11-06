import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { sessionHarnessDir } from "./session-workspace.ts";

test("sessionHarnessDir matches host .sessions layout", () => {
  const stateRoot = "/tmp/alchemist-hosts/cursor/.agent-serve";
  const id = "ses_test123";
  assert.equal(
    sessionHarnessDir(stateRoot, id),
    path.join("/tmp/alchemist-hosts/cursor", ".sessions", id),
  );
});
