import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  MessageQueue,
  SessionIndex,
  mapClaudeMessage,
  mapSessionMessages,
  nextTurnMessage,
} from "./claude.ts";

const usage = {
  input_tokens: 100,
  cache_read_input_tokens: 2000,
  cache_creation_input_tokens: 300,
  output_tokens: 50,
};

test("text deltas map to text events", () => {
  const events = mapClaudeMessage({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
  });
  assert.deepEqual(events, [{ type: "text", delta: "Hi" }]);
});

test("thinking deltas map to reasoning events", () => {
  const events = mapClaudeMessage({
    type: "stream_event",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "hmm" },
    },
  });
  assert.deepEqual(events, [{ type: "reasoning", delta: "hmm" }]);
});

test("an assistant message gives tool calls and the context size, but no text", () => {
  const events = mapClaudeMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      usage,
      content: [
        { type: "text", text: "already streamed" },
        { type: "tool_use", id: "t1", name: "mcp__alchemist__call_function", input: { name: "echo" } },
      ],
    },
  });
  assert.deepEqual(events, [
    { type: "tool", id: "t1", name: "call_function", input: { name: "echo" } },
    { type: "usage", contextTokens: 2400, cacheReadTokens: 2000, cacheWriteTokens: 300 },
  ]);
});

test("tool results map with their error flag and text output", () => {
  const events = mapClaudeMessage({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "{\"ok\":true}" }] },
        { type: "tool_result", tool_use_id: "t2", is_error: true, content: "boom" },
      ],
    },
  });
  assert.deepEqual(events, [
    { type: "tool_result", id: "t1", ok: true, output: "{\"ok\":true}" },
    { type: "tool_result", id: "t2", ok: false, output: "boom" },
  ]);
});

test("a success result gives the window, the session cost, and done", () => {
  const events = mapClaudeMessage({
    type: "result",
    subtype: "success",
    session_id: "s1",
    total_cost_usd: 0.02,
    modelUsage: {
      "claude-haiku-5-5": { contextWindow: 100_000 },
      "claude-opus-5-5": { contextWindow: 200_000 },
    },
  });
  assert.deepEqual(events, [
    { type: "usage", contextWindow: 200_000, costUsd: 0.02 },
    { type: "done", sessionId: "s1" },
  ]);
});

test("an error result gives the cost and an error", () => {
  const events = mapClaudeMessage({
    type: "result",
    subtype: "error_during_execution",
    session_id: "s1",
    total_cost_usd: 0.01,
    modelUsage: {},
    errors: ["bad", "worse"],
  });
  assert.deepEqual(events, [
    { type: "usage", costUsd: 0.01 },
    { type: "error", message: "bad\nworse" },
  ]);
});

test("subagent stream events are ignored", () => {
  const events = mapClaudeMessage({
    type: "stream_event",
    parent_tool_use_id: "t9",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } },
  });
  assert.deepEqual(events, []);
});

test("a replay maps prompts, replies, tools, and usage", () => {
  const events = mapSessionMessages([
    { type: "user", parent_tool_use_id: null, message: { role: "user", content: "hello" } },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        usage,
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "text", text: "Hi" },
          { type: "tool_use", id: "t1", name: "mcp__alchemist__find_function", input: {} },
        ],
      },
    },
    {
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }] },
    },
  ]);
  assert.deepEqual(events, [
    { type: "user", text: "hello" },
    { type: "reasoning", delta: "plan" },
    { type: "text", delta: "Hi" },
    { type: "tool", id: "t1", name: "find_function", input: {} },
    { type: "usage", contextTokens: 2400, cacheReadTokens: 2000, cacheWriteTokens: 300 },
    { type: "tool_result", id: "t1", ok: true, output: "[]" },
  ]);
});

test("the message queue hands out pushed messages in order, also to a waiting reader", async () => {
  const queue = new MessageQueue<string>();
  const reader = queue[Symbol.asyncIterator]();
  queue.push("a");
  assert.deepEqual(await reader.next(), { value: "a", done: false });
  const waiting = reader.next();
  queue.push("b");
  assert.deepEqual(await waiting, { value: "b", done: false });
});

test("an ended message queue finishes its reader and refuses new messages", async () => {
  const queue = new MessageQueue<string>();
  const reader = queue[Symbol.asyncIterator]();
  const waiting = reader.next();
  queue.end();
  assert.equal((await waiting).done, true);
  assert.throws(() => queue.push("late"));
});

function never(): Promise<void> {
  return new Promise(() => {});
}

test("a turn message arrives normally while the turn runs", async () => {
  const messages = new MessageQueue<string>();
  messages.push("m1");
  const next = await nextTurnMessage(messages[Symbol.asyncIterator](), never(), new AbortController().signal);
  assert.deepEqual(next, { value: "m1", done: false });
});

test("a stopped turn still delivers the message that arrives within the grace time", async () => {
  const messages = new MessageQueue<string>();
  const reader = messages[Symbol.asyncIterator]();
  const controller = new AbortController();
  const aborted = new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve()));
  const pending = nextTurnMessage(reader, aborted, controller.signal, 1_000);
  controller.abort();
  setTimeout(() => messages.push("result"), 10);
  assert.deepEqual(await pending, { value: "result", done: false });
});

test("a stopped turn gives up after the grace time", async () => {
  const messages = new MessageQueue<string>();
  const controller = new AbortController();
  controller.abort();
  const next = await nextTurnMessage(messages[Symbol.asyncIterator](), Promise.resolve(), controller.signal, 10);
  assert.equal(next, undefined);
});

test("the session index keeps ids across instances", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tui-index-")), "a/sessions.json");
  new SessionIndex(file).add("s1");
  const index = new SessionIndex(file);
  index.add("s1");
  index.add("s2");
  assert.deepEqual([...new SessionIndex(file).ids()], ["s1", "s2"]);
});
