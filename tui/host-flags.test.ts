import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyHostFlagsCommand } from "./host-flags.ts";

test("/flags on and off toggles a flag", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    const on = applyHostFlagsCommand("on pinnedModel", root);
    assert.match(on.message, /pinnedModel/);
    assert.equal(on.config.pinnedModel, true);
    const off = applyHostFlagsCommand("off pinnedModel", root);
    assert.equal(off.config.pinnedModel, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
