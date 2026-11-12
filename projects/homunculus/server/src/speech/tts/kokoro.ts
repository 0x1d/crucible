// Kokoro-82M TTS via kokoro-js (ONNX Runtime, CPU), native 24 kHz (spec D-02).
// Inference runs in a child process so the event loop keeps pacing audio and handling devices.
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { floatToInt16, resample } from "../audio.js";
import { modelDir } from "../paths.js";
import type { TtsProvider } from "../types.js";
import type { KokoroRequest, KokoroResponse, KokoroWorkerData } from "./kokoro-process.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const NATIVE_RATE = 24000;

export interface KokoroOptions {
  /** ONNX weights: fp32 is faster than q8 on x86 CPUs (measured, D-10). */
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  speed?: number;
}

type Pending = { resolve: (r: { audio: Float32Array; rate: number }) => void; reject: (e: Error) => void };

export class KokoroTtsProvider implements TtsProvider {
  readonly id = "kokoro";
  private worker: ChildProcess | undefined;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly opts: KokoroOptions = {}) {}

  private start(): ChildProcess {
    if (this.worker) return this.worker;
    const data: KokoroWorkerData = {
      modelId: MODEL_ID,
      dtype: this.opts.dtype ?? "fp32",
      cacheDir: `${modelDir}/hf/`,
      allowRemoteModels: process.env.HOMUNCULUS_OFFLINE !== "1",
    };
    // fork() inherits execArgv, so the tsx loader also applies to the child.
    // "advanced" serialization carries Float32Array over IPC.
    const w = fork(fileURLToPath(new URL("./kokoro-process.ts", import.meta.url)), [], {
      env: { ...process.env, HOMUNCULUS_KOKORO_WORKER: JSON.stringify(data) },
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    w.on("message", (r: KokoroResponse) => {
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (this.pending.size === 0) {
        w.unref();
        w.channel?.unref();
      }
      if ("error" in r) p.reject(new Error(r.error));
      else p.resolve(r);
    });
    const fail = (e: Error) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
      this.worker = undefined; // respawn on next request
    };
    w.on("error", fail);
    w.on("exit", (code, sig) => fail(new Error(`kokoro process exited (${code ?? sig})`)));
    // Keeps this process alive only while a synthesis is pending (scripts and tests exit when done).
    w.unref();
    w.channel?.unref();
    this.worker = w;
    return w;
  }

  private generate(text: string, voice: string): Promise<{ audio: Float32Array; rate: number }> {
    const w = this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.ref();
      w.channel?.ref();
      w.send({ id, text, voice, speed: this.opts.speed ?? 1 } satisfies KokoroRequest);
    });
  }

  async warmup(voice: string): Promise<void> {
    await this.generate("Hello.", voice);
  }

  async *synthesize(
    text: string,
    opts: { voice: string; sampleRate: number; signal: AbortSignal },
  ): AsyncIterable<Int16Array> {
    if (opts.signal.aborted) return;
    // A running inference cannot be cancelled; an aborted result is discarded.
    const out = await this.generate(text, opts.voice);
    if (opts.signal.aborted) return;
    const trimmed = trimSilence(out.audio, out.rate);
    yield floatToInt16(resample(trimmed, out.rate ?? NATIVE_RATE, opts.sampleRate));
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    if (w && w.exitCode === null) {
      const exited = new Promise((r) => w.once("exit", r));
      w.kill("SIGTERM");
      await exited;
    }
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
