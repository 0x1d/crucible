import assert from "node:assert/strict";
import test from "node:test";
import { FollowUpQueue, buildQueuedMessage } from "./follow-up-queue.ts";

test("follow-up queue is FIFO", () => {
  const queue = new FollowUpQueue();
  assert.equal(queue.enqueue({ prompt: "a", shown: "a" }), 1);
  assert.equal(queue.enqueue({ prompt: "b", shown: "b" }), 2);
  assert.deepEqual(queue.shift(), { prompt: "a", shown: "a" });
  assert.deepEqual(queue.shift(), { prompt: "b", shown: "b" });
  assert.equal(queue.length, 0);
});

test("snapshot lists queued messages in order", () => {
  const queue = new FollowUpQueue();
  queue.enqueue({ prompt: "a", shown: "a" });
  queue.enqueue({ prompt: "b", shown: "b" });
  assert.deepEqual(queue.snapshot(), [
    { prompt: "a", shown: "a" },
    { prompt: "b", shown: "b" },
  ]);
  queue.shift();
  assert.deepEqual(queue.snapshot(), [{ prompt: "b", shown: "b" }]);
});

test("unshift puts a message back at the front", () => {
  const queue = new FollowUpQueue();
  queue.enqueue({ prompt: "a", shown: "a" });
  queue.unshift({ prompt: "retry", shown: "retry" });
  assert.deepEqual(queue.shift(), { prompt: "retry", shown: "retry" });
});

test("buildQueuedMessage passes plain text through", () => {
  assert.deepEqual(buildQueuedMessage("hello", () => "unused"), {
    shown: "hello",
    prompt: "hello",
  });
});

test("buildQueuedMessage expands /remember for inject and drain", () => {
  assert.deepEqual(
    buildQueuedMessage("/remember save this", (arg) => `PROMPT:${arg}`),
    { shown: "/remember save this", prompt: "PROMPT:save this" },
  );
});
