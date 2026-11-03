import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_CONTEXT_IMPROVEMENTS,
  loadContextImprovements,
  saveContextImprovements,
} from "./context-improvements.ts";

test("load returns defaults when the file is missing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ctx-improve-"));
  try {
    assert.deepEqual(loadContextImprovements(root), DEFAULT_CONTEXT_IMPROVEMENTS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save and load round-trip", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ctx-improve-"));
  try {
    const config = { ...DEFAULT_CONTEXT_IMPROVEMENTS, pinnedModel: true };
    saveContextImprovements(config, root);
    assert.deepEqual(loadContextImprovements(root), config);
    const raw = JSON.parse(readFileSync(path.join(root, "context-improvements.json"), "utf8"));
    assert.equal(raw.pinnedModel, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
