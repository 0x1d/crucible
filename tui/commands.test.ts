import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS, parseCommand } from "./commands.ts";

test("plain text is not a command", () => {
  assert.equal(parseCommand("hello /model"), undefined);
});

test("a command splits into name and argument", () => {
  assert.deepEqual(parseCommand("/remember  only decisions "), {
    name: "remember",
    arg: "only decisions",
  });
});

test("a command without an argument has an empty argument", () => {
  assert.deepEqual(parseCommand("/diff"), { name: "diff", arg: "" });
});

test("the command list holds every command for autocomplete", () => {
  assert.deepEqual(
    COMMANDS.map((c) => c.name),
    ["host", "session", "new", "model", "effort", "diff", "remember", "ctx", "exit"],
  );
});
