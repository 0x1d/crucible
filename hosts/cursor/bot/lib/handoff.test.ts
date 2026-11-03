import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HANDOFF_BYTE_CAP,
  renderHandoff,
  seedMessage,
} from "./handoff.ts";

test("renderHandoff follows the template and omits empty sections", () => {
  const text = renderHandoff({
    state: "Investigating context growth.",
    next: ["Run evals", "Update footer"],
    files: ["docs/a.md"],
    systems: [],
    pitfalls: ["Do not use /new"],
  });
  assert.match(text, /^# Handoff\n\n## State\nInvestigating context growth\./);
  assert.match(text, /## Next\n- Run evals\n- Update footer/);
  assert.match(text, /## Files\n- docs\/a\.md/);
  assert.doesNotMatch(text, /## Systems/);
  assert.match(text, /## Pitfalls\n- Do not use \/new/);
  assert.doesNotMatch(text, /## Facts/);
});

test("renderHandoff byte length matches Buffer.byteLength", () => {
  const text = renderHandoff({ state: "ok", next: ["step"] });
  assert.equal(Buffer.byteLength(text, "utf8"), Buffer.byteLength(text, "utf8"));
});

test("renderHandoff over the cap throws and leaves no file", () => {
  const big = "x".repeat(HANDOFF_BYTE_CAP);
  assert.throws(
    () => renderHandoff({ state: big, next: ["a"] }),
    /over the 12000 byte cap/,
  );
});

test("seedMessage joins preamble, file, and user text", () => {
  assert.equal(
    seedMessage("# Handoff\n\nbody", "Continue please"),
    "Continue this work from the handoff below. The prior transcript is not in this session.\n\n# Handoff\n\nbody\n\nContinue please",
  );
});
