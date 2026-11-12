// Kokoro synthesis in a child process: in-process inference stalled the event loop by up to
// 219 ms (measured), starving the downlink pacer. A worker thread is not an option:
// onnxruntime-node aborts when sessions run on the main thread (Silero VAD) and a worker.
import type { KokoroTTS } from "kokoro-js";

export interface KokoroWorkerData {
  modelId: string;
  dtype: string;
  cacheDir: string;
  allowRemoteModels: boolean;
}

export type KokoroRequest = { id: number; text: string; voice: string; speed: number };
export type KokoroResponse =
  | { id: number; audio: Float32Array; rate: number }
  | { id: number; error: string };

const data = JSON.parse(process.env.HOMUNCULUS_KOKORO_WORKER ?? "null") as KokoroWorkerData;
if (!data || !process.send) throw new Error("kokoro-process must be forked with IPC");
const send = process.send.bind(process);
// Exit with the parent.
process.on("disconnect", () => process.exit(0));

const model: Promise<KokoroTTS> = (async () => {
  const { env } = await import("@huggingface/transformers");
  env.cacheDir = data.cacheDir;
  env.allowRemoteModels = data.allowRemoteModels;
  const { KokoroTTS } = await import("kokoro-js");
  return KokoroTTS.from_pretrained(data.modelId, { dtype: data.dtype as "fp32", device: "cpu" });
})();

// Requests are handled one at a time (inference occupies this thread anyway).
let chain = Promise.resolve();
process.on("message", (req: KokoroRequest) => {
  chain = chain.then(async () => {
    try {
      const tts = await model;
      const out = await tts.generate(req.text, { voice: req.voice as never, speed: req.speed });
      const audio = out.audio;
      send({ id: req.id, audio, rate: out.sampling_rate } satisfies KokoroResponse);
    } catch (e) {
      send({ id: req.id, error: (e as Error).message } satisfies KokoroResponse);
    }
  });
});
