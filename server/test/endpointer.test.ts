// Endpointer as a pure state machine (spec §5.4.1) and the turn watchdog helpers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { settlesWithin, Watchdog, WatchdogError, within } from "../src/orchestrator/watchdog.js";
import { defaultEndpointerOptions, Endpointer, type VadEvent } from "../src/speech/vad/endpointer.js";

const W = 32; // ms per window (512 samples at 16 kHz)

/** Runs a probability sequence; `[p, ms]` pairs expand into windows. */
function run(seq: Array<[number, number]>, opts = defaultEndpointerOptions): VadEvent[] {
  const e = new Endpointer(opts);
  const out: VadEvent[] = [];
  for (const [p, ms] of seq) for (let t = 0; t < ms; t += W) out.push(...e.update(p, W));
  return out;
}

test("speech then hangover silence → speech_start, pause, endpoint", () => {
  const ev = run([
    [0, 320],
    [0.9, 640],
    [0, 704],
  ]);
  assert.deepEqual(
    ev.map((e) => e.type),
    ["speech_start", "pause", "endpoint"],
  );
  const start = ev[0] as Extract<VadEvent, { type: "speech_start" }>;
  assert.equal(start.atMs, 320);
  const end = ev[2] as Extract<VadEvent, { type: "endpoint" }>;
  assert.equal(end.reason, "silence");
  assert.equal(end.speechEndMs, 960);
  assert.ok(end.atMs - end.speechEndMs >= defaultEndpointerOptions.hangoverMs);
});

test("short clicks below minSpeechMs are not speech", () => {
  const ev = run([
    [0.9, 96],
    [0, 200],
    [0.9, 96],
    [0, 200],
  ]);
  assert.deepEqual(ev, []);
});

test("a pause shorter than the hangover resumes the utterance", () => {
  const ev = run([
    [0.9, 320],
    [0, 320],
    [0.9, 320],
    [0, 640],
  ]);
  assert.deepEqual(
    ev.map((e) => e.type),
    ["speech_start", "pause", "resume", "pause", "endpoint"],
  );
});

test("hysteresis: probabilities between thresholds neither pause nor resume", () => {
  const ev = run([
    [0.9, 320],
    [0.4, 2000],
  ]);
  assert.deepEqual(
    ev.map((e) => e.type),
    ["speech_start"],
  );
});

test("no speech within noSpeechTimeoutMs → no_speech, then finished", () => {
  const e = new Endpointer({ ...defaultEndpointerOptions, noSpeechTimeoutMs: 640 });
  const out: VadEvent[] = [];
  for (let t = 0; t < 1000; t += W) out.push(...e.update(0, W));
  assert.deepEqual(
    out.map((x) => x.type),
    ["no_speech"],
  );
  assert.equal(e.finished, true);
  assert.deepEqual(e.update(0.9, W), []);
});

test("max utterance length cuts continuous speech", () => {
  const ev = run([[0.9, 2000]], { ...defaultEndpointerOptions, maxUtteranceMs: 1024 });
  const end = ev.at(-1) as Extract<VadEvent, { type: "endpoint" }>;
  assert.equal(end.type, "endpoint");
  assert.equal(end.reason, "max_length");
  assert.equal(end.atMs, 1024);
});

test("Watchdog fires without kicks; kicks postpone it; guard rejects with WatchdogError", async () => {
  const wd = new Watchdog(60, "x");
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 30));
    wd.kick();
  }
  await assert.rejects(wd.guard(new Promise(() => {})), WatchdogError);
  assert.ok(performance.now() - t0 >= 170);
  const ok = new Watchdog(50, "y");
  assert.equal(await ok.guard(Promise.resolve(7)), 7);
  ok.stop();
});

test("settlesWithin / within", async () => {
  assert.equal(await settlesWithin(Promise.reject(new Error("x")), 50), true);
  assert.equal(await settlesWithin(new Promise(() => {}), 20), false);
  assert.equal(await within(Promise.resolve(3), 50), 3);
  assert.equal(await within(new Promise(() => {}), 20), undefined);
});
