// Kokoro TTS benchmark (spec §5.5): synthesis time per segment length and dtype; intelligibility
// via whisper (transcript vs input text).
//
//   pnpm --filter homunculus-server exec tsx scripts/bench-tts.ts [dtypes=fp32,q8] [runs=3] [voice=bf_emma]
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger } from "../src/log.js";
import { concat, resample, wav } from "../src/speech/audio.js";
import { modelDir } from "../src/speech/paths.js";
import { WhisperCppProvider } from "../src/speech/stt/whisper-cpp.js";
import { KokoroTtsProvider } from "../src/speech/tts/kokoro.js";

const dtypes = (process.argv[2] ?? "fp32,q8").split(",") as Array<"fp32" | "q8">;
const runs = Number(process.argv[3] ?? 3);
const voice = process.argv[4] ?? "bf_emma";
const out = fileURLToPath(new URL("../.data/bench-tts", import.meta.url));
mkdirSync(out, { recursive: true });

const texts = [
  "Canberra.",
  "Right, let me look.",
  "The capital of Australia is Canberra.",
  "The capital of Australia is Canberra, which surprises a lot of people.",
  "Tomorrow in Vienna it'll be sunny and around fourteen degrees, so you can leave the umbrella at home and enjoy the walk.",
];

const words = (s: string) => s.split(/\s+/).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Word error rate of `hyp` against `ref` (Levenshtein over words). */
function wer(ref: string, hyp: string): number {
  const r = norm(ref).split(" ");
  const h = norm(hyp).split(" ").filter(Boolean);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)] as number[]);
  for (let j = 0; j <= h.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  return (d[r.length] as number[])[h.length] as number / r.length;
}

const log = createLogger({ bench: "tts" });
const stt = new WhisperCppProvider({ modelPath: `${modelDir}/whisper/ggml-base.en.bin`, partialIntervalMs: 0, log });
await stt.warmup();

const rows: string[] = [];
for (const dtype of dtypes) {
  const tts = new KokoroTtsProvider({ dtype });
  let t0 = performance.now();
  await tts.warmup(voice);
  const loadMs = Math.round(performance.now() - t0);
  console.log(`dtype ${dtype}: load+warmup ${loadMs} ms`);
  for (const [i, text] of texts.entries()) {
    const times: number[] = [];
    let pcm = new Int16Array(0);
    for (let r = 0; r < runs; r++) {
      t0 = performance.now();
      const chunks: Int16Array[] = [];
      for await (const c of tts.synthesize(text, { voice, sampleRate: 24000, signal: new AbortController().signal })) {
        chunks.push(c);
      }
      times.push(performance.now() - t0);
      pcm = concat(chunks);
    }
    writeFileSync(`${out}/${dtype}-${i}.wav`, wav(pcm, 24000));
    const f = new Float32Array(pcm.length);
    for (let k = 0; k < pcm.length; k++) f[k] = (pcm[k] as number) / 0x8000;
    const p16 = resample(f, 24000, 16000);
    const i16 = new Int16Array(p16.length);
    for (let k = 0; k < p16.length; k++) i16[k] = Math.max(-32768, Math.min(32767, Math.round((p16[k] as number) * 0x8000)));
    const { text: heard } = await stt.transcribe(i16, undefined, "en");
    times.sort((a, b) => a - b);
    const med = Math.round(times[Math.floor(times.length / 2)] as number);
    const audioMs = Math.round((pcm.length / 24000) * 1000);
    const row = `| ${dtype} | ${words(text)} | ${med} | ${Math.round(times[0] as number)} | ${audioMs} | ${(med / audioMs).toFixed(2)} | ${wer(text, heard).toFixed(2)} | ${heard} |`;
    rows.push(row);
    console.log(row);
  }
}
console.log("\n| dtype | words | synth median ms | synth min ms | audio ms | RTF | WER | whisper transcript |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log(r);
await stt.close();
process.exit(0);
