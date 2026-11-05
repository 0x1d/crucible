import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { countCompletedTurns, sessionEventsPath } from "./auto-memory-retain-kv.ts";

test("countCompletedTurns reads turn.completed lines", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "auto-retain-"));
  const sessionId = "ses_test";
  const eventsFile = sessionEventsPath(root, sessionId);
  mkdirSync(path.dirname(eventsFile), { recursive: true });
  writeFileSync(
    eventsFile,
    [
      JSON.stringify({ type: "turn.completed", data: {} }),
      JSON.stringify({ type: "message.received", data: { text: "hi" } }),
      JSON.stringify({ type: "turn.completed", data: {} }),
    ].join("\n"),
  );
  assert.equal(await countCompletedTurns(root, sessionId), 2);
});
