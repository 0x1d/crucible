import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURSOR_CONTEXT_WINDOW,
  contextTokens,
  createBody,
  followUpBody,
  mapCursorEvent,
  mapCursorEvents,
  modelConfig,
  resumeIndex,
} from "./cursor.ts";

const usage = {
  inputTokens: 100,
  cacheReadTokens: 2000,
  cacheWriteTokens: 300,
  outputTokens: 50,
};

test("disjoint cache counters are added to input", () => {
  assert.equal(contextTokens(usage), 2400);
});

test("gross input already includes the cache, so the prompt size is input", () => {
  // A real follow-up: input 188760, cache read 184832. Adding them printed 374k.
  assert.equal(
    contextTokens({ inputTokens: 188_760, cacheReadTokens: 184_832, cacheWriteTokens: 0 }),
    188_760,
  );
});

test("text and reasoning deltas map, and a completed message does not repeat them", () => {
  assert.deepEqual(
    mapCursorEvent({ type: "message.appended", data: { delta: "Hi", text: "Hi" } }),
    [{ type: "text", delta: "Hi" }],
  );
  assert.deepEqual(
    mapCursorEvent({ type: "reasoning.appended", data: { delta: "hmm", text: "hmm" } }),
    [{ type: "reasoning", delta: "hmm" }],
  );
  assert.deepEqual(mapCursorEvent({ type: "message.completed", data: { text: "Hi", finishReason: "stop" } }), []);
});

test("a live user message is not echoed", () => {
  assert.deepEqual(mapCursorEvent({ type: "message.received", data: { text: "hello" } }), []);
});

test("tool calls and results map, and nested calls are ignored", () => {
  assert.deepEqual(
    mapCursorEvent({
      type: "actions.requested",
      data: {
        calls: [
          { callId: "t1", toolName: "call_function", args: { name: "echo" } },
          { callId: "t2", toolName: "call_function", args: {}, parentCallId: "t1" },
        ],
      },
    }),
    [{ type: "tool", id: "t1", name: "call_function", input: { name: "echo" } }],
  );
  assert.deepEqual(
    mapCursorEvent({
      type: "action.result",
      data: { callId: "t1", toolName: "call_function", output: "{\"ok\":true}", isError: false },
    }),
    [{ type: "tool_result", id: "t1", ok: true, output: "{\"ok\":true}" }],
  );
  assert.deepEqual(
    mapCursorEvent({
      type: "action.result",
      data: { callId: "t2", output: { error: "boom" }, isError: true },
    }),
    [{ type: "tool_result", id: "t2", ok: false, output: "{\"error\":\"boom\"}" }],
  );
  assert.deepEqual(
    mapCursorEvent({
      type: "message.appended",
      parentTool: true,
      data: { delta: "hidden", parentCallId: "t1" },
    }),
    [],
  );
});

test("a completed turn gives the context size, the window, and done", () => {
  assert.deepEqual(
    mapCursorEvent({ type: "turn.completed", sessionId: "ses_1", data: { usage } }),
    [
      { type: "usage", contextTokens: 2400, contextWindow: CURSOR_CONTEXT_WINDOW },
      { type: "done", sessionId: "ses_1" },
    ],
  );
});

test("a failed turn gives the error message", () => {
  assert.deepEqual(mapCursorEvent({ type: "turn.failed", data: { message: "nope", status: "error" } }), [
    { type: "error", message: "nope" },
  ]);
});

test("a replay maps prompts, replies, tools, and usage once", () => {
  const events = mapCursorEvents([
    { type: "message.received", index: 0, data: { text: "hello" } },
    { type: "message.appended", index: 1, data: { delta: "Hi", text: "Hi" } },
    { type: "message.completed", index: 2, data: { text: "Hi", finishReason: "stop" } },
    {
      type: "actions.requested",
      index: 3,
      data: { calls: [{ callId: "t1", toolName: "find_function", args: {} }] },
    },
    { type: "action.result", index: 4, data: { callId: "t1", output: "[]", isError: false } },
    { type: "turn.completed", index: 5, sessionId: "ses_1", data: { usage } },
    {
      type: "reasoning.appended",
      index: 6,
      data: { delta: "secret", parentCallId: "child" },
    },
  ]);
  assert.deepEqual(events, [
    { type: "user", text: "hello" },
    { type: "text", delta: "Hi" },
    { type: "tool", id: "t1", name: "find_function", input: {} },
    { type: "tool_result", id: "t1", ok: true, output: "[]" },
    { type: "usage", contextTokens: 2400, contextWindow: CURSOR_CONTEXT_WINDOW },
    { type: "done", sessionId: "ses_1" },
  ]);
});

test("the next stream starts after the last stored index", () => {
  assert.equal(resumeIndex([]), 0);
  assert.equal(resumeIndex([{ index: 0 }, { index: 1 }, { index: 4 }]), 5);
});

test("a new session sends one prompt, and a follow-up does not resend it", () => {
  assert.deepEqual(createBody("hello", undefined, undefined), { message: "hello" });
  assert.deepEqual(createBody("hello", "grok-4.7", "high"), {
    message: "hello",
    modelConfig: modelConfig("grok-4.7", "high"),
  });
  assert.deepEqual(modelConfig("grok-4.7", "low"), {
    model: {
      id: "grok-4.7",
      params: [
        { id: "reasoning_effort", value: "low" },
        { id: "fast", value: "true" },
      ],
    },
  });
  assert.deepEqual(modelConfig("gpt-5.6", "medium"), {
    model: {
      id: "gpt-5.6",
      params: [
        { id: "reasoning", value: "medium" },
        { id: "fast", value: "true" },
      ],
    },
  });
  assert.deepEqual(followUpBody("http:tok", "next"), { continuationToken: "http:tok", message: "next" });
});
