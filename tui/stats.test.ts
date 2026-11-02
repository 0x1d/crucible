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

test("the last turn time shows in seconds", () => {
  const stats = new SessionStats();
  assert.equal(stats.turnLabel(), undefined);
  stats.lastTurnMs = 12_400;
  assert.equal(stats.turnLabel(), "12.4s");
});
