// Server-side endpointing (spec §5.2 Listening → Transcribing, §5.4.1 hangover 500–700 ms).
// Pure state machine over per-window speech probabilities; time is audio time, not wall clock.
import { int16ToFloat } from "../audio.js";
import type { VadModel, VadModelStream } from "../types.js";

export interface EndpointerOptions {
  /** Probability at or above which a window is speech. */
  threshold: number;
  /** Probability below which a window is silence (hysteresis). */
  negThreshold: number;
  /** Speech must last this long before it counts (filters clicks). */
  minSpeechMs: number;
  /** Silence after speech that ends the utterance. */
  hangoverMs: number;
  /** Listening → Idle when no speech starts within this time. */
  noSpeechTimeoutMs: number;
  /** Utterances are cut after this long. */
  maxUtteranceMs: number;
}

export const defaultEndpointerOptions: EndpointerOptions = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechMs: 150,
  hangoverMs: 600,
  noSpeechTimeoutMs: 8000,
  maxUtteranceMs: 20_000,
};

export type VadEvent =
  | { type: "speech_start"; atMs: number }
  /** First silent window after speech; `atMs` = end of speech if no resume follows. */
  | { type: "pause"; atMs: number }
  | { type: "resume"; atMs: number }
  | { type: "endpoint"; speechEndMs: number; atMs: number; reason: "silence" | "max_length" }
  | { type: "no_speech"; atMs: number };

export class Endpointer {
  private t = 0;
  private speechRun = 0;
  private silence = 0;
  private inSpeech = false;
  private spoke = false;
  private done = false;
  private speechEnd = 0;

  constructor(private readonly opts: EndpointerOptions = defaultEndpointerOptions) {}

  get finished(): boolean {
    return this.done;
  }

  get speaking(): boolean {
    return this.inSpeech && this.silence === 0;
  }

  update(prob: number, windowMs: number): VadEvent[] {
    if (this.done) return [];
    const ev: VadEvent[] = [];
    this.t += windowMs;
    const o = this.opts;
    if (!this.inSpeech) {
      if (prob >= o.threshold) {
        this.speechRun += windowMs;
        if (this.speechRun >= o.minSpeechMs) {
          this.inSpeech = this.spoke = true;
          ev.push({ type: "speech_start", atMs: this.t - this.speechRun });
        }
      } else {
        this.speechRun = 0;
      }
      if (!this.spoke && this.t >= o.noSpeechTimeoutMs) {
        this.done = true;
        ev.push({ type: "no_speech", atMs: this.t });
      }
    } else if (prob < o.negThreshold) {
      if (this.silence === 0) {
        this.speechEnd = this.t - windowMs;
        ev.push({ type: "pause", atMs: this.speechEnd });
      }
      this.silence += windowMs;
      if (this.silence >= o.hangoverMs) {
        this.done = true;
        ev.push({ type: "endpoint", speechEndMs: this.speechEnd, atMs: this.t, reason: "silence" });
      }
    } else if (this.silence > 0 && prob >= o.threshold) {
      this.silence = 0;
      ev.push({ type: "resume", atMs: this.t });
    }
    if (!this.done && this.t >= o.maxUtteranceMs) {
      this.done = true;
      ev.push({ type: "endpoint", speechEndMs: this.silence ? this.speechEnd : this.t, atMs: this.t, reason: "max_length" });
    }
    return ev;
  }
}

/** Splits 16 kHz PCM into model windows and runs the endpointer over them. */
export class VadSegmenter {
  readonly endpointer: Endpointer;
  private readonly stream: VadModelStream;
  private rest = new Float32Array(0);
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly model: VadModel,
    opts: EndpointerOptions = defaultEndpointerOptions,
  ) {
    this.stream = model.stream();
    this.endpointer = new Endpointer(opts);
  }

  /** Processes frames strictly in order; resolves with the events this frame produced. */
  push(pcm: Int16Array): Promise<VadEvent[]> {
    const next = this.chain.then(() => this.process(pcm));
    this.chain = next.catch(() => {});
    return next;
  }

  private async process(pcm: Int16Array): Promise<VadEvent[]> {
    const n = this.model.windowSamples;
    const f = int16ToFloat(pcm);
    const all = new Float32Array(this.rest.length + f.length);
    all.set(this.rest);
    all.set(f, this.rest.length);
    const events: VadEvent[] = [];
    let off = 0;
    for (; off + n <= all.length && !this.endpointer.finished; off += n) {
      const p = await this.stream.probability(all.subarray(off, off + n));
      events.push(...this.endpointer.update(p, (n / 16000) * 1000));
    }
    this.rest = all.slice(off);
    return events;
  }
}
