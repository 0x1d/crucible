import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { SessionStats } from "./stats.ts";
import { createTheme, themes } from "./theme.ts";
import {
  ToolLine,
  Transcript,
  changeLine,
  colorDiff,
  followUpQueueLines,
  footerLine,
} from "./view.ts";

const theme = createTheme("alchemist", themes.alchemist, "truecolor");
const plain = (lines: string[]) => lines.map(stripTerminalSequences);

test("follow-up queue lines list messages and optional inject hint", () => {
  const plainLines = stripTerminalSequences(
    followUpQueueLines(theme, [{ shown: "first" }, { shown: "/remember x" }], {
      injectHint: true,
    }),
  );
  assert.match(plainLines, /^queued \(2\)/);
  assert.match(plainLines, /empty Enter injects #1/);
  assert.match(plainLines, /1\. first/);
  assert.match(plainLines, /2\. \/remember x/);
  assert.equal(followUpQueueLines(theme, []), "");
});

test("the footer joins host, model, effort, context, cost, and turn time", () => {
  const stats = new SessionStats();
  stats.apply({ type: "usage", contextTokens: 41_234, contextWindow: 200_000, costUsd: 0.083 });
  stats.lastTurnMs = 12_400;
  const line = footerLine(theme, { host: "claude", model: "opus", effort: "high", stats });
  assert.equal(stripTerminalSequences(line), "claude · opus · high · ctx 41.2k/200k (21%) · $0.083 · 12.4s");
});

test("the footer shows a cache hit with read, write, and new tokens", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 90_136,
    contextWindow: 200_000,
    cacheReadTokens: 80_896,
    cacheWriteTokens: 0,
    costUsd: 0.083,
  });
  const line = footerLine(theme, { host: "cursor", model: "auto", effort: undefined, stats });
  assert.equal(
    stripTerminalSequences(line),
    "cursor · auto · ctx 90.1k/200k (45%) · hit · read 80.9k · write 0 · new 9.2k · $0.083",
  );
});

test("the footer shows a cache miss when nothing was read", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 26_000,
    contextWindow: 200_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  const line = footerLine(theme, { host: "cursor", model: "auto", effort: undefined, stats });
  assert.equal(
    stripTerminalSequences(line),
    "cursor · auto · ctx 26k/200k (13%) · miss · read 0 · write 0 · new 26k · $0.000",
  );
});

test("the footer shows cache write separately from cache read", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 2_400,
    contextWindow: 200_000,
    cacheReadTokens: 2_000,
    cacheWriteTokens: 300,
  });
  const line = footerLine(theme, { host: "claude", model: "opus", effort: undefined, stats });
  assert.equal(
    stripTerminalSequences(line),
    "claude · opus · ctx 2.4k/200k (1%) · hit · read 2k · write 300 · new 100 · $0.000",
  );
});

test("the footer colors context, cache, and new tokens", () => {
  const stats = new SessionStats();
  stats.apply({
    type: "usage",
    contextTokens: 90_136,
    contextWindow: 200_000,
    cacheReadTokens: 80_896,
    cacheWriteTokens: 0,
  });
  const line = footerLine(theme, { host: "cursor", model: "auto", effort: undefined, stats });
  assert.ok(line.includes(theme.fg.success("ctx 90.1k/200k (45%)")));
  assert.ok(line.includes(theme.fg.success("hit")));
  assert.ok(line.includes(theme.fg.success("read 80.9k")));
  assert.ok(line.includes(theme.fg.success("write 0")));
  assert.ok(line.includes(theme.fg.accent("new 9.2k")));

  const warn = new SessionStats();
  warn.apply({ type: "usage", contextTokens: 160_000, contextWindow: 200_000 });
  assert.ok(
    footerLine(theme, { host: "cursor", model: "auto", effort: undefined, stats: warn }).includes(
      theme.fg.warning("ctx 160k/200k (80%)"),
    ),
  );

  const over = new SessionStats();
  over.apply({ type: "usage", contextTokens: 210_000, contextWindow: 200_000 });
  assert.ok(
    footerLine(theme, { host: "cursor", model: "auto", effort: undefined, stats: over }).includes(
      theme.fg.error("ctx 210k/200k (105%)"),
    ),
  );
});

test("the footer shows default when no model or effort is set", () => {
  const line = footerLine(theme, { host: "claude", model: undefined, effort: undefined, stats: new SessionStats() });
  assert.equal(stripTerminalSequences(line), "claude · default · ctx 0 · $0.000");
});

test("a finished turn shows its token stats under the reply", () => {
  const view = new Transcript(theme);
  view.apply({ type: "user", text: "hello" });
  view.apply({ type: "text", delta: "Hi there" });
  view.apply({
    type: "usage",
    contextTokens: 90_136,
    cacheReadTokens: 80_896,
    cacheWriteTokens: 0,
  });
  const pending = plain(view.render(80));
  assert.equal(pending.some((line) => line.includes("ctx")), false);

  view.apply({ type: "usage", contextWindow: 200_000, costUsd: 0.02 });
  view.apply({ type: "done", sessionId: "s1" });
  const lines = plain(view.render(80));
  const answer = lines.findIndex((line) => line.includes("Hi there"));
  const stats = lines.findIndex((line) => line.includes("ctx 90.1k/200k (45%)"));
  assert.ok(answer >= 0 && stats > answer);
  assert.equal(lines[stats].trimEnd(), "ctx 90.1k/200k (45%) · hit · read 80.9k · write 0 · new 9.2k");
  assert.ok(view.render(80).join("\n").includes(theme.fg.success("hit")));
  assert.ok(view.render(80).join("\n").includes(theme.fg.accent("new 9.2k")));

  view.endTurn();
  assert.equal(plain(view.render(80)).filter((line) => line.includes("ctx")).length, 1);
});

test("each reply keeps its own token line", () => {
  const view = new Transcript(theme);
  view.apply({ type: "user", text: "one" });
  view.apply({ type: "text", delta: "First" });
  view.apply({ type: "usage", contextTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
  view.apply({ type: "user", text: "two" });
  view.apply({ type: "text", delta: "Second" });
  view.apply({
    type: "usage",
    contextTokens: 160_000,
    contextWindow: 200_000,
    cacheReadTokens: 150_000,
    cacheWriteTokens: 0,
  });
  view.endTurn();
  const lines = plain(view.render(80));
  const first = lines.findIndex((line) => line.includes("ctx 1k"));
  const secondPrompt = lines.findIndex((line) => line.includes("you> two"));
  const second = lines.findIndex((line) => line.includes("ctx 160k/200k (80%)"));
  assert.ok(first >= 0 && first < secondPrompt && secondPrompt < second);
  assert.equal(lines[first].trimEnd(), "ctx 1k · miss · read 0 · write 0 · new 1k");
  assert.equal(lines[second].trimEnd(), "ctx 160k/200k (80%) · hit · read 150k · write 0 · new 10k");
});

test("a turn without a context size has no token line", () => {
  const view = new Transcript(theme);
  view.apply({ type: "text", delta: "Hi" });
  view.apply({ type: "usage", costUsd: 0.02 });
  view.apply({ type: "done", sessionId: "s1" });
  assert.equal(plain(view.render(80)).some((line) => line.includes("ctx")), false);
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
