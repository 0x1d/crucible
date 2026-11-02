import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { SessionStats } from "./stats.ts";
import { createTheme, themes } from "./theme.ts";
import { ToolLine, changeLine, colorDiff, footerLine } from "./view.ts";

const theme = createTheme("alchemist", themes.alchemist, "truecolor");
const plain = (lines: string[]) => lines.map(stripTerminalSequences);

test("the footer joins host, model, effort, context, cost, and turn time", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 41_234, contextWindow: 200_000, costUsd: 0.083 });
  stats.lastTurnMs = 12_400;
  const line = footerLine(theme, { host: "claude", model: "opus", effort: "high", stats });
  assert.equal(stripTerminalSequences(line), "claude · opus · high · ctx 41.2k/200k (21%) · $0.083 · 12.4s");
});

test("the footer shows default when no model or effort is set", () => {
  const line = footerLine(theme, { host: "claude", model: undefined, effort: undefined, stats: new SessionStats() });
  assert.equal(stripTerminalSequences(line), "claude · default · ctx 0 · $0.000");
});

test("a running tool call is 1 line with a run marker", () => {
  const tool = new ToolLine(theme, "call_function", { name: "echo" });
  assert.deepEqual(plain(tool.render(80)), ['▸ call_function {"name":"echo"}']);
});

test("a long tool input is cut to the width", () => {
  const tool = new ToolLine(theme, "call_function", { text: "x".repeat(200) });
  assert.ok(stripTerminalSequences(tool.render(40)[0]).length <= 40);
});

test("a finished tool call shows its result marker", () => {
  const tool = new ToolLine(theme, "call_function", {});
  tool.finish(false, "boom");
  assert.ok(plain(tool.render(80))[0].startsWith("✗ call_function"));
});

test("an expanded tool call shows input and output", () => {
  const tool = new ToolLine(theme, "call_function", { name: "echo" });
  tool.finish(true, "result text");
  tool.expanded = true;
  const lines = plain(tool.render(80));
  assert.equal(lines[0], '✓ call_function {"name":"echo"}');
  assert.ok(lines.includes('      "name": "echo"'));
  assert.ok(lines.includes("    result text"));
});

test("the change line names the file and its counts", () => {
  assert.equal(
    stripTerminalSequences(changeLine(theme, { path: "functions/x.ex", added: 12, removed: 3 })),
    "✎ functions/x.ex +12 −3",
  );
});

test("colorDiff colors added and removed lines and keeps the text", () => {
  const out = colorDiff(theme, "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n ctx");
  const lines = out.split("\n");
  assert.equal(lines[3], theme.fg.error("-old"));
  assert.equal(lines[4], theme.fg.success("+new"));
  assert.equal(lines[5], " ctx");
  assert.equal(stripTerminalSequences(out), "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n ctx");
});
