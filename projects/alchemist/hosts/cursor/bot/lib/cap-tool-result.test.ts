import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ToolExecuteResult } from "@grok/agent-sdk";

import { capToolResult } from "./cap-tool-result.ts";
import { serialized } from "./result-digest.ts";

function largeFindResult(): ToolExecuteResult {
  const hits = Array.from({ length: 80 }, (_, i) => ({
    name: `demo.entry_${i}`,
    summary: `Synthetic hit ${i} `.repeat(40),
    spec: "@spec run(map()) :: {:ok, map()} | {:error, String.t()}",
  }));
  return { ok: true, functions: hits, count: hits.length };
}

test("capToolResult digests a large find_function payload when resultDigest is on", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "cap-tool-"));
  try {
    const raw = largeFindResult();
    const before = serialized(raw);
    assert.ok(before !== undefined && before.length > 8_000);
    const capped = await capToolResult(raw, { workspaceDir, toolCallId: "find-1" }, "find_function");
    const after = serialized(capped);
    assert.ok(after !== undefined && after.length < before.length / 2);
    assert.ok(capped && typeof capped === "object" && !Array.isArray(capped));
    assert.equal((capped as { truncated?: boolean }).truncated, true);
    const artifact = path.join(workspaceDir, "artifacts", "find-1.json");
    assert.ok(readFileSync(artifact, "utf8").length > 8_000);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
