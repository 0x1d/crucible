import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberPrompt } from "./remember.ts";

const now = new Date("2026-11-02T10:00:00Z");

test("the prompt starts with a checkpoint marker", () => {
  const prompt = rememberPrompt({ sessionId: "abc", instructions: "", now });
  assert.ok(prompt.startsWith("[memory-checkpoint 2026-11-02T10:00:00.000Z]\n"));
});

test("the prompt names memory.remember and the session id", () => {
  const prompt = rememberPrompt({ sessionId: "abc", instructions: "", now });
  assert.match(prompt, /memory\.remember/);
  assert.match(prompt, /Set source_session to abc\./);
});

test("the prompt omits source_session when the session has no id yet", () => {
  const prompt = rememberPrompt({ sessionId: undefined, instructions: "", now });
  assert.doesNotMatch(prompt, /source_session/);
});

test("user instructions go at the end", () => {
  const prompt = rememberPrompt({ sessionId: "abc", instructions: "  only decisions  ", now });
  assert.ok(prompt.endsWith("\nonly decisions"));
});
