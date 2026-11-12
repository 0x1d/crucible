import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exploreGateBlocked,
  isProbeSlug,
  markExploreGateSatisfied,
  resetExploreGate,
} from "./explore-gate.ts";

const ws = "/tmp/ws-explore-gate";

test("isProbeSlug matches common probes", () => {
  assert.equal(isProbeSlug("fs.rg"), true);
  assert.equal(isProbeSlug("git.status"), true);
  assert.equal(isProbeSlug("fs.read"), false);
  assert.equal(isProbeSlug("explore"), false);
});

test("exploreGateBlocked until explore satisfies gate", () => {
  resetExploreGate(ws);
  assert.ok(exploreGateBlocked("fs.rg", ws, true)?.error?.includes("explore"));
  assert.equal(exploreGateBlocked("explore", ws, true), null);
  assert.equal(exploreGateBlocked("fs.rg", ws, true), null);
  resetExploreGate(ws);
  markExploreGateSatisfied(ws);
  assert.equal(exploreGateBlocked("sys.cmd", ws, true), null);
});
