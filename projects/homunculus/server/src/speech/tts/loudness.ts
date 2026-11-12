// Loudness stage for TTS output: fixed gain + soft limiter (small device speakers).
// Kokoro speech measured at -20.5 dBFS mean, -2 to -5 dBFS peak.
import type { TtsProvider } from "../types.js";

/** Soft-knee limiter: linear below `knee`, tanh-compressed above, never exceeds `ceiling`. */
export function applyGain(pcm: Int16Array, gainDb: number, knee = 0.5, ceiling = 0.97): Int16Array {
  const g = 10 ** (gainDb / 20);
  const out = new Int16Array(pcm.length);
  const range = ceiling - knee;
  for (let i = 0; i < pcm.length; i++) {
    const x = ((pcm[i] as number) / 32768) * g;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + range * Math.tanh((a - knee) / range);
    out[i] = Math.round(Math.sign(x) * y * 32767);
  }
  return out;
}

export class LoudnessTtsProvider implements TtsProvider {
  readonly id: string;

  constructor(
    private readonly inner: TtsProvider,
    private readonly gainDb: number,
  ) {
    this.id = inner.id;
  }

  async *synthesize(text: string, opts: { voice: string; sampleRate: number; signal: AbortSignal }): AsyncIterable<Int16Array> {
    for await (const pcm of this.inner.synthesize(text, opts)) yield applyGain(pcm, this.gainDb);
  }

  warmup(voice: string): Promise<void> {
    return this.inner.warmup?.(voice) ?? Promise.resolve();
  }

  close(): Promise<void> {
    return this.inner.close?.() ?? Promise.resolve();
  }
}
