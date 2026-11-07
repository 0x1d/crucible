// PCM helpers and Opus framing (spec §4.3, §5.4.2: resample → Opus 60 ms).
import OpusScript from "opusscript";

export type OpusRate = 8000 | 12000 | 16000 | 24000 | 48000;

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i] as number));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function int16ToFloat(p: Int16Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = (p[i] as number) / 0x8000;
  return out;
}

export function concat(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Windowed-sinc resampler for whole buffers (one TTS sentence at a time).
 * Cut-off at the lower Nyquist frequency, so downsampling does not alias.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = to / from;
  const n = Math.round(input.length * ratio);
  const out = new Float32Array(n);
  const cutoff = Math.min(1, ratio); // relative to input Nyquist
  const half = 16; // taps on each side, in input samples (scaled when downsampling)
  const width = Math.ceil(half / cutoff);
  for (let i = 0; i < n; i++) {
    const center = i / ratio;
    const lo = Math.max(0, Math.floor(center) - width + 1);
    const hi = Math.min(input.length - 1, Math.floor(center) + width);
    let acc = 0;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const x = (j - center) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const t = (j - center) / width;
      const win = 0.5 + 0.5 * Math.cos(Math.PI * Math.max(-1, Math.min(1, t))); // Hann
      const w = sinc * win;
      acc += (input[j] as number) * w;
      norm += w;
    }
    out[i] = norm > 0 ? acc / norm : 0;
  }
  return out;
}

/** RIFF/WAVE PCM16 mono. */
export function wav(pcm: Int16Array, rate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Uplink decoder: one Opus packet → PCM16 (spec §4.3, 16 kHz mono 60 ms). */
export class OpusDecoder {
  private readonly dec: OpusScript;

  constructor(rate: OpusRate = 16000) {
    this.dec = new OpusScript(rate, 1, OpusScript.Application.VOIP);
  }

  decode(packet: Uint8Array): Int16Array {
    const out = this.dec.decode(Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength));
    return new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
  }

  delete(): void {
    this.dec.delete();
  }
}

/** Downlink encoder: PCM16 → 60 ms Opus packets; partial frames are buffered until flush. */
export class OpusFramer {
  readonly frameSamples: number;
  private readonly enc: OpusScript;
  private pending = new Int16Array(0);

  constructor(
    readonly rate: OpusRate,
    frameMs = 60,
    bitrate = 32_000,
  ) {
    this.frameSamples = (rate * frameMs) / 1000;
    this.enc = new OpusScript(rate, 1, OpusScript.Application.AUDIO);
    this.enc.setBitrate(bitrate);
  }

  push(pcm: Int16Array): Uint8Array[] {
    const all = this.pending.length ? concat([this.pending, pcm]) : pcm;
    const out: Uint8Array[] = [];
    let off = 0;
    for (; off + this.frameSamples <= all.length; off += this.frameSamples) {
      out.push(this.encode(all.subarray(off, off + this.frameSamples)));
    }
    this.pending = all.slice(off);
    return out;
  }

  /** Encodes the remaining samples padded with silence (end of a segment). */
  flush(): Uint8Array[] {
    if (this.pending.length === 0) return [];
    const frame = new Int16Array(this.frameSamples);
    frame.set(this.pending);
    this.pending = new Int16Array(0);
    return [this.encode(frame)];
  }

  /** Drops buffered samples (barge-in). */
  reset(): void {
    this.pending = new Int16Array(0);
  }

  delete(): void {
    this.enc.delete();
  }

  private encode(frame: Int16Array): Uint8Array {
    const b = this.enc.encode(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength), this.frameSamples);
    return Uint8Array.from(b);
  }
}
