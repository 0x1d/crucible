// SpeechOutput (spec §5.2 pipelining, §5.3.1 heardSoFar), OpusFramer and resampler (spec §5.4.2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FrameFlag } from "@homunculus/protocol";
import { Pacer } from "../src/gateway/pacer.js";
import { SpeechOutput, type PacedItem } from "../src/orchestrator/speech-out.js";
import { OpusDecoder, OpusFramer, resample } from "../src/speech/audio.js";
import { captureLog, FakeTts, sleep } from "./fakes.js";

function setup(rate: 16000 | 24000 = 24000) {
  const tts = new FakeTts();
  const framer = new OpusFramer(rate);
  const sent: PacedItem["frame"][] = [];
  const events: string[] = [];
  const pacer = new Pacer<PacedItem>((item) => {
    item.before?.();
    sent.push(item.frame);
    item.after?.();
  });
  let id = 0;
  const out = new SpeechOutput({
    tts,
    voice: "v",
    framer,
    pacer,
    nextSegmentId: () => ++id,
    onSegmentStart: (sid, text, first, filler) => events.push(`start:${sid}:${text}:${first}:${filler}`),
    onSegmentEnd: (sid) => events.push(`end:${sid}`),
    onChunk: (filler) => events.push(`chunk:${filler}`),
    log: captureLog(),
  });
  return { tts, framer, pacer, sent, events, out };
}

test("segments are synthesised and sent in order with First/Last flags per segment", async () => {
  const s = setup();
  s.tts.chunks = 3;
  s.out.enqueue("One.");
  s.out.enqueue("Two.", { filler: true });
  s.out.enqueue("Three.");
  await s.out.finish();
  assert.deepEqual(s.tts.texts, ["One.", "Two.", "Three."]);
  assert.deepEqual(
    s.events.filter((e) => !e.startsWith("chunk")),
    ["start:1:One.:true:false", "end:1", "start:2:Two.:false:true", "end:2", "start:3:Three.:false:false", "end:3"],
  );
  // 3 chunks of 60 ms → 3 frames per segment; Last held back to the final frame.
  assert.equal(s.sent.length, 9);
  for (let seg = 0; seg < 3; seg++) {
    const frames = s.sent.slice(seg * 3, seg * 3 + 3);
    assert.deepEqual(
      frames.map((f) => [f.streamId, f.seq, f.flags]),
      [
        [seg + 1, 0, FrameFlag.First],
        [seg + 1, 1, 0],
        [seg + 1, 2, FrameFlag.Last],
      ],
    );
  }
  assert.ok(s.events.includes("chunk:true") && s.events.includes("chunk:false"));
});

test("a one-frame segment carries First and Last", async () => {
  const s = setup();
  s.tts.chunks = 1;
  s.out.enqueue("Hi.");
  await s.out.finish();
  assert.deepEqual(
    s.sent.map((f) => f.flags),
    [FrameFlag.First | FrameFlag.Last],
  );
});

test("enqueue while the loop is finishing starts a new loop", async () => {
  const s = setup();
  s.out.enqueue("A.");
  await sleep(1);
  s.out.enqueue("B.");
  await s.out.finish();
  s.out.enqueue("C.");
  await s.out.finish();
  assert.deepEqual(s.tts.texts, ["A.", "B.", "C."]);
  assert.equal(s.out.segments.length, 3);
});

test("cancel stops synthesis; no segment_end after cancel", async () => {
  const s = setup();
  s.tts.chunks = 5;
  s.tts.chunkDelayMs = 20;
  s.out.enqueue("Long one.");
  s.out.enqueue("Never.");
  await sleep(50);
  s.out.cancel();
  s.pacer.clear();
  await s.out.finish();
  assert.deepEqual(s.tts.texts, ["Long one."]);
  assert.ok(!s.events.some((e) => e.startsWith("end")));
  s.out.enqueue("Ignored.");
  await s.out.finish();
  assert.deepEqual(s.tts.texts, ["Long one."]);
});

test("heardText: played segments plus the one playing, filler excluded", async () => {
  const s = setup();
  s.tts.chunks = 1;
  for (const t of ["One.", "Moment.", "Two.", "Three.", "Four."]) s.out.enqueue(t, { filler: t === "Moment." });
  await s.out.finish();
  // All started; nothing confirmed played yet → only the first (playing) one.
  assert.equal(s.out.heardText(), "One.");
  s.out.played(3); // implies 1 and 2 played; 4 is playing
  assert.equal(s.out.heardText(), "One. Two. Three.");
  s.out.played(5);
  assert.equal(s.out.heardText(), "One. Two. Three. Four.");
});

test("lastPlayed resolves on tts.played or after the timeout", async () => {
  const s = setup();
  s.tts.chunks = 1;
  s.out.enqueue("A.");
  await s.out.finish();
  const t0 = performance.now();
  await s.out.lastPlayed(80);
  assert.ok(performance.now() - t0 >= 70);
  const s2 = setup();
  s2.tts.chunks = 1;
  s2.out.enqueue("B.");
  await s2.out.finish();
  setTimeout(() => s2.out.played(1), 10);
  const t1 = performance.now();
  await s2.out.lastPlayed(1000);
  assert.ok(performance.now() - t1 < 500);
});

for (const rate of [16000, 24000] as const) {
  test(`OpusFramer ${rate} Hz: 60 ms frames, partial buffering, flush padding, decodable`, () => {
    const f = new OpusFramer(rate);
    assert.equal(f.frameSamples, (rate * 60) / 1000);
    const tone = new Int16Array(Math.round(f.frameSamples * 2.5));
    for (let i = 0; i < tone.length; i++) tone[i] = Math.round(6000 * Math.sin((2 * Math.PI * 300 * i) / rate));
    assert.equal(f.push(tone.subarray(0, f.frameSamples / 2)).length, 0);
    assert.equal(f.push(tone.subarray(f.frameSamples / 2)).length, 2);
    const tail = f.flush();
    assert.equal(tail.length, 1);
    assert.equal(f.flush().length, 0);
    const dec = new OpusDecoder(rate);
    assert.equal(dec.decode(tail[0] as Uint8Array).length, f.frameSamples);
    f.push(tone.subarray(0, 10));
    f.reset();
    assert.equal(f.flush().length, 0);
    dec.delete();
    f.delete();
  });
}

test("resample keeps duration and frequency (24 → 16 kHz and back)", () => {
  const from = 24000;
  const x = new Float32Array(from); // 1 s of 500 Hz
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 500 * i) / from);
  const crossings = (a: Float32Array) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if ((a[i - 1] as number) < 0 !== (a[i] as number) < 0) n++;
    return n;
  };
  const y = resample(x, from, 16000);
  assert.equal(y.length, 16000);
  assert.ok(Math.abs(crossings(y) - 1000) <= 2, `crossings ${crossings(y)}`);
  const z = resample(y, 16000, 24000);
  assert.equal(z.length, 24000);
  assert.ok(Math.abs(crossings(z) - 1000) <= 2);
  assert.equal(resample(x, from, from), x);
});
