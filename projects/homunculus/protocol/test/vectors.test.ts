import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeFrame, encodeFrame, FrameError, parseDeviceMessage, parseServerMessage } from "../src/index.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

const frames = load("frames.json");
const messages = load("messages.json");

for (const v of frames.valid) {
  test(`frame valid: ${v.name}`, () => {
    const f = decodeFrame(hex(v.hex));
    assert.equal(f.type, v.type);
    assert.equal(f.flags, v.flags);
    assert.equal(f.streamId, v.stream_id);
    assert.equal(f.seq, v.seq);
    assert.equal(Buffer.from(f.payload).toString("hex"), v.payload_hex);
    assert.equal(Buffer.from(encodeFrame(f)).toString("hex"), v.hex);
  });
}

for (const v of frames.invalid) {
  test(`frame invalid: ${v.name}`, () => {
    assert.throws(() => decodeFrame(hex(v.hex)), FrameError);
  });
}

const parsers = { device: parseDeviceMessage, server: parseServerMessage } as const;

for (const dir of ["device", "server"] as const) {
  const parse = parsers[dir];
  for (const m of messages[dir].valid) {
    test(`${dir} valid: ${JSON.stringify(m).slice(0, 70)}`, () => {
      const r = parse(JSON.stringify(m));
      assert.ok(r.ok, r.ok ? "" : `${r.kind}: ${"error" in r ? r.error : r.type}`);
    });
  }
  for (const m of messages[dir].invalid) {
    test(`${dir} invalid: ${JSON.stringify(m).slice(0, 70)}`, () => {
      const r = parse(JSON.stringify(m));
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.kind, "invalid");
    });
  }
  for (const m of messages[dir].unknown) {
    test(`${dir} unknown: ${m.type}`, () => {
      const r = parse(m);
      assert.deepEqual(r, { ok: false, kind: "unknown", type: m.type });
    });
  }
}

test("malformed JSON is invalid", () => {
  const r = parseDeviceMessage("{nope");
  assert.equal(!r.ok && r.kind, "invalid");
});
