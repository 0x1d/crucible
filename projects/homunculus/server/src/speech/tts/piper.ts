// Piper TTS fallback (spec D-02): one `piper --output-raw` process per segment.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Logger } from "../../log.js";
import { floatToInt16, int16ToFloat, resample } from "../audio.js";
import type { TtsProvider } from "../types.js";

export interface PiperOptions {
  /** Directory holding `<voice>.onnx` and `<voice>.onnx.json`. */
  modelDir: string;
  bin?: string;
  log: Logger;
}

/** Piper voices are named like `en_GB-jenny_dioco-medium`; Kokoro voice names map to this default. */
const DEFAULT_VOICE = "en_GB-jenny_dioco-medium";

export class PiperTtsProvider implements TtsProvider {
  readonly id = "piper";

  constructor(private readonly opts: PiperOptions) {}

  private model(voice: string): { path: string; rate: number } {
    const name = voice.includes("-") ? voice : DEFAULT_VOICE;
    const path = `${this.opts.modelDir}/${name}.onnx`;
    if (!existsSync(path)) throw new Error(`piper voice missing: ${path} (run pnpm fetch-models --piper)`);
    const cfg = JSON.parse(readFileSync(`${path}.json`, "utf8")) as { audio?: { sample_rate?: number } };
    return { path, rate: cfg.audio?.sample_rate ?? 22050 };
  }

  async *synthesize(
    text: string,
    opts: { voice: string; sampleRate: number; signal: AbortSignal },
  ): AsyncIterable<Int16Array> {
    const { path, rate } = this.model(opts.voice);
    const proc = spawn(this.opts.bin ?? "piper", ["-m", path, "--output-raw"], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });
    let err = "";
    proc.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-1000)));
    proc.on("error", () => {});
    // Created before reading stdout so a close (incl. death by signal) is never missed.
    const closed = new Promise<number | null>((r) => proc.once("close", (code) => r(code)));
    proc.stdin.end(`${text.replace(/\s+/g, " ")}\n`);
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of proc.stdout as AsyncIterable<Buffer>) chunks.push(chunk);
    } catch (e) {
      if (!opts.signal.aborted) throw e;
    }
    const code = await closed;
    if (opts.signal.aborted) return;
    if (code !== 0) this.opts.log.warn("piper_failed", { code, error: err.trim() });
    const buf = Buffer.concat(chunks);
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~1)));
    // Resampled per segment (whole buffer) to avoid edge artefacts between chunks.
    yield rate === opts.sampleRate ? pcm : floatToInt16(resample(int16ToFloat(pcm), rate, opts.sampleRate));
  }
}
