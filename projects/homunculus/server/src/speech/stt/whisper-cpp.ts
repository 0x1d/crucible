// whisper.cpp STT (spec D-01): a warm `whisper-server` process, one HTTP request per transcription.
// Pseudo-streaming: partials re-transcribe the utterance so far while speech is ongoing.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { Logger } from "../../log.js";
import { concat, wav } from "../audio.js";
import type { SttProvider, SttResult, SttStream } from "../types.js";

export interface WhisperCppOptions {
  /** ggml model file. */
  modelPath: string;
  /** Use a running whisper-server instead of spawning one. */
  url?: string;
  bin?: string;
  threads?: number;
  /** Interval of new audio between partial transcriptions; 0 disables partials. */
  partialIntervalMs?: number;
  /** Default spoken language (`-l`); a stream's `language` overrides it per request. */
  language?: string;
  log: Logger;
}

const RATE = 16000;
/** Upper bound for one whisper-server request; a hung server must not wedge a turn. */
const INFERENCE_TIMEOUT_MS = 15_000;

/**
 * Encoder context for an utterance of `samples` length: whisper.cpp encodes 30 s (1500 positions)
 * by default; a context sized to the audio cuts encode time ~3x on CPU. Too small a context
 * makes the decoder fall back to higher temperatures (slow), so keep ≥ 2× the audio and ≥ 384.
 */
export function audioCtx(samples: number): number {
  const positions = Math.ceil((samples / RATE) * 50 * 2);
  return Math.min(1500, Math.max(384, Math.ceil(positions / 64) * 64));
}

/** Whisper's non-speech outputs ("[BLANK_AUDIO]", "(wind blowing)") count as empty. */
export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const stripped = t.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, "").trim();
  return /[\p{L}\p{N}]/u.test(stripped) ? stripped : "";
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export class WhisperCppProvider implements SttProvider {
  readonly id = "whisper-cpp";
  private proc: ChildProcess | undefined;
  private ready: Promise<string> | undefined;
  private readonly log: Logger;

  constructor(private readonly opts: WhisperCppOptions) {
    this.log = opts.log.child({ component: "whisper" });
  }

  warmup(): Promise<void> {
    return this.endpoint().then(() => undefined);
  }

  /** Base URL of a ready whisper-server. */
  private endpoint(): Promise<string> {
    this.ready ??= this.opts.url ? Promise.resolve(this.opts.url) : this.start();
    return this.ready;
  }

  private async start(): Promise<string> {
    if (!existsSync(this.opts.modelPath)) {
      throw new Error(`whisper model missing: ${this.opts.modelPath} (run pnpm fetch-models)`);
    }
    const port = await freePort();
    const args = ["-m", this.opts.modelPath, "--host", "127.0.0.1", "--port", String(port)];
    args.push("-t", String(this.opts.threads ?? 4), "-l", this.opts.language ?? "en", "-nt", "-sns");
    const t0 = performance.now();
    const proc = spawn(this.opts.bin ?? "whisper-server", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    let tail = "";
    const collect = (c: Buffer) => {
      tail = (tail + c.toString()).slice(-2000);
    };
    proc.stdout?.on("data", collect);
    proc.stderr?.on("data", collect);
    const exited = new Promise<never>((_, reject) => {
      proc.once("error", reject);
      proc.once("exit", (code) => reject(new Error(`whisper-server exited ${code}: ${tail.trim()}`)));
    });
    exited.catch(() => {});
    const url = `http://127.0.0.1:${port}`;
    for (;;) {
      const up = await Promise.race([
        fetch(`${url}/`).then(
          (r) => r.ok,
          () => false,
        ),
        exited,
      ]);
      if (up) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    proc.once("exit", (code) => {
      this.log.error("whisper_exit", { code, tail: tail.trim().slice(-500) });
      this.ready = undefined;
    });
    this.log.info("whisper_ready", { url, model: this.opts.modelPath, ms: Math.round(performance.now() - t0) });
    return url;
  }

  /** Transcribes one buffer; returns cleaned text and the request duration. */
  async transcribe(pcm: Int16Array, signal?: AbortSignal, language?: string): Promise<{ text: string; ms: number }> {
    const url = await this.endpoint();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav(pcm, RATE))], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    form.append("temperature", "0.0");
    form.append("audio_ctx", String(audioCtx(pcm.length)));
    form.append("no_timestamps", "true");
    if (language) form.append("language", language);
    const t0 = performance.now();
    const res = await fetch(`${url}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(INFERENCE_TIMEOUT_MS)].filter((s) => s !== undefined)),
    });
    if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { text?: string; error?: string };
    if (body.error) throw new Error(`whisper-server: ${body.error}`);
    return { text: cleanTranscript(body.text ?? ""), ms: Math.round(performance.now() - t0) };
  }

  open(opts: { language?: string; sampleRate: 16000 }): SttStream {
    return new WhisperStream(this, this.opts.partialIntervalMs ?? 1000, this.log, opts.language ?? this.opts.language);
  }

  async close(): Promise<void> {
    this.proc?.kill("SIGTERM");
    this.proc = undefined;
  }
}

class WhisperStream implements SttStream {
  private chunks: Int16Array[] = [];
  private samples = 0;
  private lastPartialAt = 0;
  private inflight: Promise<void> | undefined;
  private speaking = false;
  private ended = false;
  private readonly abort = new AbortController();
  /** Partials are aborted at end(): the final must not wait for a stale partial. */
  private readonly partialAbort = new AbortController();
  private readonly queue: SttResult[] = [];
  private wake: (() => void) | undefined;
  private done = false;
  private lastPartial = "";

  constructor(
    private readonly provider: WhisperCppProvider,
    private readonly partialIntervalMs: number,
    private readonly log: Logger,
    private readonly language: string | undefined,
  ) {}

  write(pcm: Int16Array): void {
    if (this.ended) return;
    this.chunks.push(pcm);
    this.samples += pcm.length;
    const due = this.samples - this.lastPartialAt >= (this.partialIntervalMs * RATE) / 1000;
    // Partials only while speech is ongoing, so no request is in flight when the endpoint arrives.
    if (this.partialIntervalMs > 0 && this.speaking && due && !this.inflight) {
      this.lastPartialAt = this.samples;
      const pcmSoFar = concat(this.chunks);
      this.inflight = this.provider
        .transcribe(pcmSoFar, AbortSignal.any([this.abort.signal, this.partialAbort.signal]), this.language)
        .then(({ text, ms }) => {
          this.log.debug("stt_partial", { ms, audio_ms: Math.round((pcmSoFar.length / RATE) * 1000), text });
          if (text && text !== this.lastPartial && !this.ended) {
            this.lastPartial = text;
            this.emit({ text, final: false });
          }
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") this.log.warn("stt_partial_failed", { error: e.message });
        })
        .finally(() => (this.inflight = undefined));
    }
  }

  vadHint(speaking: boolean): void {
    this.speaking = speaking;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.partialAbort.abort();
    void (async () => {
      try {
        await this.inflight;
        if (this.abort.signal.aborted) return;
        const pcm = concat(this.chunks);
        const { text, ms } = pcm.length ? await this.provider.transcribe(pcm, this.abort.signal, this.language) : { text: "", ms: 0 };
        this.log.info("stt_final", { ms, audio_ms: Math.round((pcm.length / RATE) * 1000), ctx: audioCtx(pcm.length) });
        this.emit({ text, final: true });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          this.log.error("stt_failed", { error: (e as Error).message });
          this.emit({ text: "", final: true });
        }
      } finally {
        this.finish();
      }
    })();
  }

  cancel(): void {
    this.ended = true;
    this.abort.abort();
    this.finish();
  }

  async *results(): AsyncIterable<SttResult> {
    for (;;) {
      const r = this.queue.shift();
      if (r) {
        yield r;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  private emit(r: SttResult): void {
    this.queue.push(r);
    this.wakeUp();
  }

  private finish(): void {
    this.done = true;
    this.wakeUp();
  }

  private wakeUp(): void {
    const w = this.wake;
    this.wake = undefined;
    w?.();
  }
}
