// Kokoro-82M TTS via kokoro-js (ONNX Runtime, CPU), native 24 kHz (spec D-02).
import type { KokoroTTS } from "kokoro-js";
import { floatToInt16, resample } from "../audio.js";
import { modelDir } from "../paths.js";
import type { TtsProvider } from "../types.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const NATIVE_RATE = 24000;

export interface KokoroOptions {
  /** ONNX weights: fp32 is faster than q8 on x86 CPUs (measured). */
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  speed?: number;
}

export class KokoroTtsProvider implements TtsProvider {
  readonly id = "kokoro";
  private model: Promise<KokoroTTS> | undefined;

  constructor(private readonly opts: KokoroOptions = {}) {}

  private load(): Promise<KokoroTTS> {
    this.model ??= (async () => {
      const { env } = await import("@huggingface/transformers");
      env.cacheDir = `${modelDir}/hf/`;
      env.allowRemoteModels = process.env.HOMUNCULUS_OFFLINE !== "1";
      const { KokoroTTS } = await import("kokoro-js");
      return KokoroTTS.from_pretrained(MODEL_ID, { dtype: this.opts.dtype ?? "fp32", device: "cpu" });
    })();
    return this.model;
  }

  async warmup(voice: string): Promise<void> {
    const tts = await this.load();
    await tts.generate("Hello.", { voice: voice as never });
  }

  async *synthesize(
    text: string,
    opts: { voice: string; sampleRate: number; signal: AbortSignal },
  ): AsyncIterable<Int16Array> {
    const tts = await this.load();
    if (opts.signal.aborted) return;
    const audio = await tts.generate(text, { voice: opts.voice as never, speed: this.opts.speed ?? 1 });
    if (opts.signal.aborted) return;
    const trimmed = trimSilence(audio.audio, audio.sampling_rate);
    yield floatToInt16(resample(trimmed, audio.sampling_rate ?? NATIVE_RATE, opts.sampleRate));
  }
}

/** Drops leading silence (time to first audio) and caps trailing silence at 150 ms. */
export function trimSilence(pcm: Float32Array, rate: number, threshold = 0.01): Float32Array {
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start] as number) < threshold) start++;
  let end = pcm.length;
  while (end > start && Math.abs(pcm[end - 1] as number) < threshold) end--;
  const pad = Math.round(rate * 0.01);
  return pcm.subarray(Math.max(0, start - pad), Math.min(pcm.length, end + Math.round(rate * 0.15)));
}
