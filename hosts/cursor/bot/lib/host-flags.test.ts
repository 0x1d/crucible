import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_HOST_FLAGS,
  DEFAULT_MEMORY_EXPLORE_SETTINGS,
  defaultHostFlags,
  hostFlagEnvKey,
  loadHostFlags,
  loadMemoryExploreSettings,
  saveHostFlags,
  setHistoryReclaim,
  historyReclaimFromBooleans,
  deriveReclaimFlags,
  normalizeHistoryReclaim,
  reclaimModesForHost,
  parseReclaimModeToken,
} from "./host-flags.ts";

test("memory explore settings default", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-me-"));
  try {
    assert.deepEqual(loadMemoryExploreSettings(root), DEFAULT_MEMORY_EXPLORE_SETTINGS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cursor defaults use handoffFork reclaim; digests on; model pin off", () => {
  assert.equal(DEFAULT_HOST_FLAGS.historyReclaim, "handoffFork");
  assert.equal(DEFAULT_HOST_FLAGS.resultDigest, true);
  assert.equal(DEFAULT_HOST_FLAGS.handoffTool, true);
  assert.equal(DEFAULT_HOST_FLAGS.handoffFork, true);
  assert.equal(DEFAULT_HOST_FLAGS.autoSummarize, false);
  assert.equal(DEFAULT_HOST_FLAGS.autoCompact, false);
  assert.equal(DEFAULT_HOST_FLAGS.pinnedModel, false);
  assert.equal(DEFAULT_HOST_FLAGS.defaultMaxBytes, true);
});

test("claude defaults use autocompact reclaim", () => {
  const flags = defaultHostFlags("claude");
  assert.equal(flags.historyReclaim, "autocompact");
  assert.equal(flags.autoCompact, true);
  assert.equal(flags.autoSummarize, false);
  assert.equal(flags.handoffTool, false);
  assert.equal(flags.handoffFork, false);
  assert.equal(flags.resultDigest, true);
});

test("reclaim modes are host-specific", () => {
  assert.deepEqual(reclaimModesForHost("cursor"), ["summarize", "handoffFork", "off"]);
  assert.deepEqual(reclaimModesForHost("claude"), ["autocompact", "handoffFork", "off"]);
  assert.equal(normalizeHistoryReclaim("autocompact", "cursor"), "summarize");
  assert.equal(normalizeHistoryReclaim("summarize", "claude"), "autocompact");
});

test("reclaim flags are mutually exclusive", () => {
  assert.deepEqual(deriveReclaimFlags("summarize"), {
    handoffTool: false,
    handoffFork: false,
    autoSummarize: true,
    autoCompact: false,
  });
  assert.deepEqual(deriveReclaimFlags("autocompact"), {
    handoffTool: false,
    handoffFork: false,
    autoSummarize: false,
    autoCompact: true,
  });
  assert.deepEqual(deriveReclaimFlags("handoffFork"), {
    handoffTool: true,
    handoffFork: true,
    autoSummarize: false,
    autoCompact: false,
  });
  assert.deepEqual(deriveReclaimFlags("off"), {
    handoffTool: false,
    handoffFork: false,
    autoSummarize: false,
    autoCompact: false,
  });
  assert.equal(
    historyReclaimFromBooleans({ autoSummarize: true, autoCompact: true, handoffFork: true }),
    "summarize",
  );
  assert.equal(historyReclaimFromBooleans({ autoCompact: true, handoffFork: true }), "autocompact");
});

test("load returns defaults when the file is missing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    assert.deepEqual(loadHostFlags(root), DEFAULT_HOST_FLAGS);
    assert.deepEqual(loadHostFlags(root, "claude"), defaultHostFlags("claude"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save and load round-trip preserves historyReclaim", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    const config = { ...DEFAULT_HOST_FLAGS, pinnedModel: true };
    saveHostFlags(config, root);
    assert.deepEqual(loadHostFlags(root), config);
    const raw = JSON.parse(readFileSync(path.join(root, "host-flags.json"), "utf8"));
    assert.equal(raw.pinnedModel, true);
    assert.equal(raw.historyReclaim, "handoffFork");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setHistoryReclaim switches exclusive mode per host", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    const next = setHistoryReclaim("summarize", root, "cursor");
    assert.equal(next.historyReclaim, "summarize");
    assert.equal(next.autoSummarize, true);
    assert.equal(next.autoCompact, false);
    assert.equal(next.handoffFork, false);
    assert.equal(loadHostFlags(root, "cursor").historyReclaim, "summarize");

    const claude = setHistoryReclaim("autocompact", root, "claude");
    assert.equal(claude.historyReclaim, "autocompact");
    assert.equal(claude.autoCompact, true);

    assert.throws(() => setHistoryReclaim("autocompact", root, "cursor"), /not valid for cursor/);
    assert.throws(() => setHistoryReclaim("summarize", root, "claude"), /not valid for claude/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boolean-only files derive historyReclaim and normalize per host", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "host-flags-"));
  try {
    writeLegacy(root, { resultDigest: true, handoffTool: false, handoffFork: false });
    assert.equal(loadHostFlags(root, "cursor").historyReclaim, "off");
    writeLegacy(root, { resultDigest: true, handoffTool: true, handoffFork: true });
    assert.equal(loadHostFlags(root, "cursor").historyReclaim, "handoffFork");
    writeLegacy(root, { resultDigest: true, autoCompact: true });
    assert.equal(loadHostFlags(root, "cursor").historyReclaim, "summarize");
    assert.equal(loadHostFlags(root, "claude").historyReclaim, "autocompact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseReclaimModeToken accepts aliases and rejects cross-host modes", () => {
  assert.equal(parseReclaimModeToken("autoSummarize", "cursor"), "summarize");
  assert.equal(parseReclaimModeToken("summarize", "cursor"), "summarize");
  assert.equal(parseReclaimModeToken("compact", "claude"), "autocompact");
  assert.equal(parseReclaimModeToken("autocompact", "claude"), "autocompact");
  assert.equal(parseReclaimModeToken("compact", "cursor"), undefined);
  assert.equal(parseReclaimModeToken("summarize", "claude"), undefined);
});

test("hostFlagEnvKey maps camelCase ids", () => {
  assert.equal(hostFlagEnvKey("resultDigest"), "ALCHEMIST_HOST_FLAG_RESULT_DIGEST");
  assert.equal(hostFlagEnvKey("handoffTool"), "ALCHEMIST_HOST_FLAG_HANDOFF_TOOL");
  assert.equal(hostFlagEnvKey("autoSummarize"), "ALCHEMIST_HOST_FLAG_AUTO_SUMMARIZE");
  assert.equal(hostFlagEnvKey("autoCompact"), "ALCHEMIST_HOST_FLAG_AUTO_COMPACT");
  assert.equal(hostFlagEnvKey("historyReclaim"), "ALCHEMIST_HOST_FLAG_HISTORY_RECLAIM");
});

function writeLegacy(root: string, flags: Record<string, boolean>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "host-flags.json"), `${JSON.stringify(flags, null, 2)}\n`);
}
