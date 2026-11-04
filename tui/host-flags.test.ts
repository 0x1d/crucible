import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { applyHostFlagsCommand } from "./host-flags.ts";

test("/flags on and off toggles a non-reclaim flag", () => {
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

test("/flags reclaim switches exclusive mode on claude", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    const compact = applyHostFlagsCommand("reclaim autocompact", root, "claude");
    assert.equal(compact.config.historyReclaim, "autocompact");
    assert.equal(compact.config.autoCompact, true);
    assert.equal(compact.config.handoffFork, false);

    const handoff = applyHostFlagsCommand("reclaim handoffFork", root, "claude");
    assert.equal(handoff.config.historyReclaim, "handoffFork");
    assert.equal(handoff.config.handoffTool, true);
    assert.equal(handoff.config.autoCompact, false);

    const off = applyHostFlagsCommand("reclaim off", root, "claude");
    assert.equal(off.config.historyReclaim, "off");
    assert.equal(off.config.handoffFork, false);
    assert.equal(off.config.autoCompact, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("/flags reclaim switches exclusive mode on cursor", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    const summarize = applyHostFlagsCommand("reclaim summarize", root, "cursor");
    assert.equal(summarize.config.historyReclaim, "summarize");
    assert.equal(summarize.config.autoSummarize, true);
    assert.equal(summarize.config.autoCompact, false);
    assert.equal(summarize.config.handoffFork, false);

    const rejected = applyHostFlagsCommand("reclaim autocompact", root, "cursor");
    assert.match(rejected.message, /host-invalid|Unknown/);
    assert.equal(rejected.config.historyReclaim, "summarize");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("/flags on autoSummarize turns off handoff on cursor", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    applyHostFlagsCommand("reclaim handoffFork", root, "cursor");
    const next = applyHostFlagsCommand("on autoSummarize", root, "cursor");
    assert.equal(next.config.historyReclaim, "summarize");
    assert.equal(next.config.handoffTool, false);
    assert.equal(next.config.autoSummarize, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("/flags on autoCompact turns off handoff on claude", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    applyHostFlagsCommand("reclaim handoffFork", root, "claude");
    const next = applyHostFlagsCommand("on autoCompact", root, "claude");
    assert.equal(next.config.historyReclaim, "autocompact");
    assert.equal(next.config.handoffTool, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("/flags rejects cross-host reclaim toggles", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-cmd-"));
  try {
    const cursor = applyHostFlagsCommand("on autoCompact", root, "cursor");
    assert.match(cursor.message, /Claude-only/);
    const claude = applyHostFlagsCommand("on autoSummarize", root, "claude");
    assert.match(claude.message, /Cursor-only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
