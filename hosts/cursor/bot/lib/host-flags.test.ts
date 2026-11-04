import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_HOST_FLAGS,
  hostFlagEnvKey,
  loadHostFlags,
  saveHostFlags,
} from "./host-flags.ts";

test("defaults enable digests and handoff, leave model pin off", () => {
  assert.equal(DEFAULT_HOST_FLAGS.resultDigest, true);
  assert.equal(DEFAULT_HOST_FLAGS.handoffTool, true);
  assert.equal(DEFAULT_HOST_FLAGS.handoffFork, true);
  assert.equal(DEFAULT_HOST_FLAGS.pinnedModel, false);
});

test("load returns defaults when the file is missing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    assert.deepEqual(loadHostFlags(root), DEFAULT_HOST_FLAGS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save and load round-trip", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    const config = { ...DEFAULT_HOST_FLAGS, pinnedModel: true };
    saveHostFlags(config, root);
    assert.deepEqual(loadHostFlags(root), config);
    const raw = JSON.parse(readFileSync(path.join(root, "host-flags.json"), "utf8"));
    assert.equal(raw.pinnedModel, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hostFlagEnvKey maps camelCase ids", () => {
  assert.equal(hostFlagEnvKey("resultDigest"), "ALCHEMIST_HOST_FLAG_RESULT_DIGEST");
  assert.equal(hostFlagEnvKey("handoffTool"), "ALCHEMIST_HOST_FLAG_HANDOFF_TOOL");
});
