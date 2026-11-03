import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionStats, formatTokens } from "./stats.ts";

test("formatTokens uses k above 1000", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(41_234), "41.2k");
  assert.equal(formatTokens(200_000), "200k");
});

test("context shows tokens only when the window is unknown", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 41_234 });
  assert.equal(stats.contextLabel(), "ctx 41.2k");
  assert.equal(stats.contextRatio(), undefined);
});

test("context shows the window and percentage when known", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 41_234, contextWindow: 200_000 });
  assert.equal(stats.contextLabel(), "ctx 41.2k/200k (21%)");
  assert.equal(stats.contextRatio(), 41_234 / 200_000);
});

test("the last usage event sets the context tokens", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 10_000 });
  stats.apply({ type: "usage", contextTokens: 12_000 });
  assert.equal(stats.contextTokens, 12_000);
});

test("the latest running total is the session cost", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", costUsd: 0.05 });
  stats.apply({ type: "usage", costUsd: 0.083 });
  assert.equal(stats.costLabel(), "$0.083");
});

test("a usage event without cost keeps the session cost", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", costUsd: 0.05 });
  stats.apply({ type: "usage", contextTokens: 12_000 });
  assert.equal(stats.costLabel(), "$0.050");
});

test("a replay without cost data is partial until the first live total", () => {
  const stats = SessionStats.fromReplay([{ type: "usage", contextTokens: 5_000 }]);
  assert.equal(stats.contextTokens, 5_000);
  assert.equal(stats.costLabel(), "~$0.000");
  stats.apply({ type: "usage", costUsd: 0.21 });
  assert.equal(stats.costLabel(), "$0.210");
  assert.equal(stats.costComplete, true);
});

test("a cache read is a hit and splits cached from new", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 90_136,
    cacheReadTokens: 80_896,
    cacheWriteTokens: 0,
  });
  assert.equal(stats.cacheHit(), true);
  assert.equal(stats.cachedTokens(), 80_896);
  assert.equal(stats.newTokens(), 9_240);
});

test("a reported read of zero is a miss", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 26_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 4_000,
  });
  assert.equal(stats.cacheHit(), false);
  assert.equal(stats.cachedTokens(), 4_000);
  assert.equal(stats.newTokens(), 22_000);
});

test("a cost-only usage event keeps the previous cache counters", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 2_400, cacheReadTokens: 2_000, cacheWriteTokens: 300 });
  stats.apply({ type: "usage", costUsd: 0.02 });
  assert.equal(stats.cacheHit(), true);
  assert.equal(stats.cachedTokens(), 2_300);
  assert.equal(stats.newTokens(), 100);
});

test("the last turn time shows in seconds", () => {
  const stats = new SessionStats();
  assert.equal(stats.turnLabel(), undefined);
  stats.lastTurnMs = 12_400;
  assert.equal(stats.turnLabel(), "12.4s");
});
