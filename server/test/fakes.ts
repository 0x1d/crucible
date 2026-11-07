// Fakes for orchestrator tests: device link, STT, TTS, VAD, agent (via the DeviceLink/deps seams).
import { EventEmitter } from "node:events";
import { FrameFlag, FrameType, type AudioFrame, type DeviceMessage, type ServerMessage } from "@homunculus/protocol";
import type { ConnectionEvents } from "../src/gateway/connection.js";
import type { AgentBackend, AgentEvent, AgentInput, AgentSession, SessionContext } from "../src/inference/types.js";
import type { Fields, Logger } from "../src/log.js";
import { OpusFramer } from "../src/speech/audio.js";
import type { SttProvider, SttResult, SttStream, TtsProvider, VadModel } from "../src/speech/types.js";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LogEntry {
  level: string;
  event: string;
  fields: Fields;
}

/** Logger that records entries instead of printing them. */
export function captureLog(entries: LogEntry[] = [], base: Fields = {}): Logger & { entries: LogEntry[] } {
  const w = (level: string) => (event: string, fields: Fields = {}) => entries.push({ level, event, fields: { ...base, ...fields } });
  return {
    entries,
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
    child: (f) => captureLog(entries, { ...base, ...f }),
  };
}

/** Polls `pred` until it returns a truthy value. */
export async function until<T>(pred: () => T | undefined | false, timeoutMs = 3000, what = "condition"): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await sleep(5);
  }
}

/** Fake device connection: records control messages and downlink frames. */
export class FakeLink extends EventEmitter<ConnectionEvents> {
  readonly log: Logger & { entries: LogEntry[] };
  readonly downlink = { format: "opus" as const, sample_rate: 24000, channels: 1, frame_ms: 60 };
  readonly sent: ServerMessage[] = [];
  readonly frames: Array<Omit<AudioFrame, "type">> = [];
  /** Reply tts.played this long after each segment_end (undefined: never). */
  playedAfterMs: number | undefined = 0;

  constructor() {
    super();
    this.log = captureLog();
  }

  send(m: ServerMessage): void {
    this.sent.push(m);
    if (m.type === "tts" && m.state === "segment_end" && this.playedAfterMs !== undefined) {
      const id = m.segment_id ?? 0;
      setTimeout(() => this.emit("message", { type: "tts.played", segment_id: id }), this.playedAfterMs);
    }
  }

  sendAudio(frame: Omit<AudioFrame, "type">): void {
    this.frames.push(frame);
  }

  message(m: DeviceMessage): void {
    this.emit("message", m);
  }

  /** Index of the first sent message matching `pred` at or after `from`, waiting for it. */
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 3000, from = 0): Promise<ServerMessage> {
    return until(() => this.sent.slice(from).find(pred), timeoutMs, "server message");
  }

  types(): string[] {
    return this.sent.map((m) => {
      const s = m as { type: string; state?: string; phase?: string };
      return [s.type, s.state ?? s.phase].filter(Boolean).join(":");
    });
  }

  avatar(): string[] {
    return this.sent.flatMap((m) => (m.type === "avatar" && m.state ? [m.state] : []));
  }
}

/** 60 ms Opus uplink packets at 16 kHz: speech (440 Hz tone) or silence. */
export class Uplink {
  private readonly enc = new OpusFramer(16000);
  private seq = 0;
  private phase = 0;

  constructor(
    private readonly link: FakeLink,
    readonly streamId = 1,
  ) {}

  frame(speech: boolean, flags = 0, streamId = this.streamId): void {
    const pcm = new Int16Array(960);
    if (speech) for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * this.phase++) / 16000));
    const [payload] = this.enc.push(pcm);
    const first = this.seq === 0 ? FrameFlag.First : 0;
    this.link.emit("audio", { type: FrameType.OpusUplink, flags: flags | first, streamId, seq: this.seq++, payload: payload as Uint8Array });
  }

  send(speechFrames: number, silenceFrames = 0, last = false): void {
    for (let i = 0; i < speechFrames; i++) this.frame(true);
    for (let i = 0; i < silenceFrames; i++) this.frame(false, last && i === silenceFrames - 1 ? FrameFlag.Last : 0);
  }
}

/** VAD: speech probability from window energy. */
export const fakeVad: VadModel = {
  windowSamples: 512,
  stream: () => ({
    probability: async (w: Float32Array) => {
      let e = 0;
      for (const v of w) e += v * v;
      return Math.sqrt(e / w.length) > 0.05 ? 0.95 : 0.02;
    },
  }),
};

export class FakeStt implements SttProvider {
  readonly id = "fake-stt";
  /** Final transcript per utterance (in order); `null` = never finalises. */
  finals: Array<string | null> = [];
  finalDelayMs = 5;
  readonly streams: FakeSttStream[] = [];

  open(): SttStream {
    const final = this.finals.length ? (this.finals.shift() as string | null) : "";
    const s = new FakeSttStream(final, this.finalDelayMs);
    this.streams.push(s);
    return s;
  }
}

export class FakeSttStream implements SttStream {
  samples = 0;
  ended = false;
  cancelled = false;
  private queue: SttResult[] = [];
  private done = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly final: string | null,
    private readonly delayMs: number,
  ) {}

  write(pcm: Int16Array): void {
    this.samples += pcm.length;
  }

  end(): void {
    this.ended = true;
    if (this.final === null) return;
    setTimeout(() => {
      if (this.cancelled) return;
      this.queue.push({ text: this.final as string, final: true });
      this.done = true;
      this.wake?.();
    }, this.delayMs);
  }

  cancel(): void {
    this.cancelled = true;
    this.done = true;
    this.wake?.();
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
}

/** TTS: `chunks` chunks of 60 ms tone per segment; `hang` texts never finish. */
export class FakeTts implements TtsProvider {
  readonly id = "fake-tts";
  chunks = 2;
  chunkDelayMs = 2;
  hang = new Set<string>();
  readonly texts: string[] = [];

  async *synthesize(text: string, opts: { voice: string; sampleRate: number; signal: AbortSignal }): AsyncIterable<Int16Array> {
    this.texts.push(text);
    if (this.hang.has(text)) await new Promise(() => {});
    for (let i = 0; i < this.chunks; i++) {
      await sleep(this.chunkDelayMs);
      if (opts.signal.aborted) return;
      yield new Int16Array((opts.sampleRate * 60) / 1000).fill(1000);
    }
  }
}

export type Step = AgentEvent | { wait: number } | { hang: true } | { throw: string };

/** Agent session running a scripted list of steps per send(); mimics the Claude backend's busy rule. */
export class FakeSession implements AgentSession {
  readonly inputs: AgentInput[] = [];
  closed = false;
  busy = false;
  interrupts = 0;
  /** How long interrupt() takes to end the stream; `Infinity` = never. */
  interruptMs = 0;

  constructor(
    readonly sessionId: string,
    readonly ctx: SessionContext,
    private readonly scripts: Step[][],
  ) {}

  async *send(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (this.closed) {
      yield { type: "error", message: "agent process ended", retryable: true, fatal: true };
      return;
    }
    if (this.busy) throw new Error("turn already in progress");
    this.busy = true;
    this.inputs.push(input);
    const script = this.scripts.shift() ?? [{ type: "text.delta", text: "Okay." }, { type: "done" }];
    let interrupted: Promise<void> | undefined;
    const onAbort = () => {
      this.interrupts++;
      // A stuck interrupt ends only when the session is closed (like a killed CLI process).
      interrupted =
        this.interruptMs === Infinity
          ? (async () => {
              while (!this.closed) await sleep(5);
            })()
          : sleep(this.interruptMs);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      yield { type: "status", phase: "thinking" };
      for (const step of script) {
        if (interrupted) break;
        if ("wait" in step) {
          const t0 = Date.now();
          while (Date.now() - t0 < step.wait && !interrupted && !this.closed) await sleep(2);
        } else if ("hang" in step) {
          while (!this.closed) await sleep(5);
        } else if ("throw" in step) {
          throw new Error(step.throw);
        } else {
          yield step;
        }
        if (this.closed) return;
      }
      if (interrupted) {
        await interrupted;
        yield { type: "done", interrupted: true };
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.busy = false;
    }
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Backend handing out FakeSessions; scripts are shared across sessions in order. */
export class FakeBackend implements AgentBackend {
  readonly id = "fake";
  readonly sessions: FakeSession[] = [];
  readonly resumes: Array<string | undefined> = [];
  scripts: Step[][] = [];
  interruptMs = 0;

  capabilities() {
    return { streamingText: true, toolEvents: true, interrupt: true, sessions: true };
  }

  async openSession(ctx: SessionContext): Promise<AgentSession> {
    this.resumes.push(ctx.resumeSessionId);
    const s = new FakeSession(`sess-${this.sessions.length + 1}`, ctx, this.scripts);
    s.interruptMs = this.interruptMs;
    this.sessions.push(s);
    return s;
  }

  /** All inputs sent to any session, in order. */
  get inputs(): AgentInput[] {
    return this.sessions.flatMap((s) => s.inputs);
  }
}
