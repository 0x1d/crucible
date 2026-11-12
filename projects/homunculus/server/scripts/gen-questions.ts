// Generates spoken test questions (WAV, 16 kHz) for the simulator with Kokoro.
//
//   pnpm --filter homunculus-server gen-questions [out-dir]   (default server/.data/questions)
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KokoroTtsProvider } from "../src/speech/tts/kokoro.js";
import { concat, wav } from "../src/speech/audio.js";

const out = process.argv[2] ?? fileURLToPath(new URL("../.data/questions", import.meta.url));
mkdirSync(out, { recursive: true });

const questions: Record<string, string> = {
  tokyo: "What time is it in Tokyo?",
  joke: "Tell me a short joke.",
  weather: "What's the weather in Vienna tomorrow?",
  story: "Tell me a long story about a lighthouse keeper.",
  capital: "What is the capital of Australia?",
};

// A different voice than the persona's, so the user is distinguishable in recordings.
const tts = new KokoroTtsProvider();
for (const [name, text] of Object.entries(questions)) {
  const chunks: Int16Array[] = [];
  for await (const c of tts.synthesize(text, { voice: "am_michael", sampleRate: 16000, signal: new AbortController().signal })) {
    chunks.push(c);
  }
  const pcm = concat([new Int16Array(4800), ...chunks]); // 300 ms lead-in
  writeFileSync(`${out}/${name}.wav`, wav(pcm, 16000));
  console.log(`${out}/${name}.wav  ${(pcm.length / 16000).toFixed(2)} s  "${text}"`);
}
