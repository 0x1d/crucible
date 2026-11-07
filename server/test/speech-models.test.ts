// Integration tests against the real speech models; skipped when `pnpm fetch-models` has not run.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { concat } from "../src/speech/audio.js";
import { modelDir } from "../src/speech/paths.js";
import { KokoroTtsProvider } from "../src/speech/tts/kokoro.js";
import { VadSegmenter, type VadEvent } from "../src/speech/vad/endpointer.js";
import { SileroVad } from "../src/speech/vad/silero.js";

const silero = `${modelDir}/silero/silero_vad.onnx`;
const kokoro = `${modelDir}/hf/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx`;
const skip = !existsSync(silero) || !existsSync(kokoro) ? "models not fetched" : false;

test("Kokoro speech is detected and endpointed by Silero VAD", { skip, timeout: 60_000 }, async () => {
  const tts = new KokoroTtsProvider();
  const chunks: Int16Array[] = [];
  const signal = new AbortController().signal;
  for await (const c of tts.synthesize("What time is it in Tokyo?", { voice: "am_michael", sampleRate: 16000, signal })) {
    chunks.push(c);
  }
  const speech = concat(chunks);
  assert.ok(speech.length > 16000 * 0.8, `speech ${speech.length} samples`);
  // 0.5 s silence, speech, 1.5 s silence, in 60 ms frames.
  const audio = concat([new Int16Array(8000), speech, new Int16Array(24000)]);
  const seg = new VadSegmenter(await SileroVad.load(silero));
  const events: VadEvent[] = [];
  for (let off = 0; off + 960 <= audio.length; off += 960) events.push(...(await seg.push(audio.subarray(off, off + 960))));
  const start = events.find((e) => e.type === "speech_start");
  const end = events.find((e) => e.type === "endpoint");
  assert.ok(start && start.atMs >= 350 && start.atMs <= 800, `speech_start ${JSON.stringify(start)}`);
  assert.ok(end && end.type === "endpoint", `events ${JSON.stringify(events)}`);
  const speechEnd = 500 + (speech.length / 16000) * 1000;
  assert.ok(Math.abs(end.speechEndMs - speechEnd) < 300, `speech end ${end.speechEndMs} vs ${speechEnd}`);
  assert.ok(end.atMs - end.speechEndMs >= 600, "hangover");
});
