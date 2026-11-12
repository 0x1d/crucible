// Downloads speech models into the model cache (not committed; spec §5.4).
//
//   pnpm --filter homunculus-server fetch-models [--piper] [whisper-model ...]
//
// Cache: HOMUNCULUS_MODEL_DIR (default server/models/). Default whisper model: base.en.
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { modelDir } from "../src/speech/paths.js";

const HF = "https://huggingface.co";

const args = process.argv.slice(2);
const piper = args.includes("--piper");
const named = args.filter((a) => !a.startsWith("--"));
const whisperModels = named.length ? named : ["base.en"];
const PIPER_VOICE = "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx";

const files: Array<{ url: string; path: string }> = [
  ...(piper
    ? [".onnx", ".onnx.json"].map((ext) => ({
        url: `${HF}/rhasspy/piper-voices/resolve/main/${PIPER_VOICE.replace(/\.onnx$/, ext)}`,
        path: `piper/en_GB-jenny_dioco-medium${ext}`,
      }))
    : []),
  ...whisperModels.map((m) => ({
    url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`,
    path: `whisper/ggml-${m}.bin`,
  })),
  // Silero VAD v5 (MIT).
  {
    url: "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx",
    path: "silero/silero_vad.onnx",
  },
  // Kokoro-82M ONNX (Apache-2.0), transformers.js cache layout; voices ship with kokoro-js.
  ...["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"].map((f) => ({
    url: `${HF}/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/${f}`,
    path: `hf/onnx-community/Kokoro-82M-v1.0-ONNX/${f}`,
  })),
];

for (const f of files) {
  const dest = `${modelDir}/${f.path}`;
  if (existsSync(dest)) {
    console.log(`ok   ${dest}`);
    continue;
  }
  mkdirSync(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
  process.stdout.write(`get  ${f.url}\n`);
  const res = await fetch(f.url);
  if (!res.ok || !res.body) throw new Error(`${f.url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest);
  console.log(`done ${dest}`);
}
