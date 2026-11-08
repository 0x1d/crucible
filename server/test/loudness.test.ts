import assert from "node:assert/strict";
import { test } from "node:test";
import { applyGain } from "../src/speech/tts/loudness.js";

test("applyGain boosts quiet samples linearly and never clips", () => {
  const pcm = Int16Array.from([0, 1000, -1000, 16000, -32768, 32767]);
  const out = applyGain(pcm, 8);
  const g = 10 ** (8 / 20);
  assert.equal(out[0], 0);
  assert.ok(Math.abs((out[1] as number) - 1000 * g) <= 1);
  assert.equal(out[2], -(out[1] as number));
  for (const v of out) assert.ok(Math.abs(v) <= 0.97 * 32767 + 1, `sample ${v}`);
  assert.ok((out[3] as number) > 16000 && (out[3] as number) < (out[5] as number), "monotonic above knee");
});
