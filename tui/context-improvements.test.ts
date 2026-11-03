import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyContextCommand } from "./context-improvements.ts";

test("/ctx on and off toggles a flag", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ctx-cmd-test-"));
  try {
    const on = applyContextCommand("on pinnedModel", root);
    assert.match(on.message, /pinnedModel/);
    assert.equal(on.config.pinnedModel, true);
    const off = applyContextCommand("off pinnedModel", root);
    assert.equal(off.config.pinnedModel, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
