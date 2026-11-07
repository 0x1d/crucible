// Speech output of one turn (spec §5.2 turn pipelining, §5.4.2):
// segments → TTS (sequential, overlapping playback of earlier segments) → Opus 60 ms → pacer.
import { FrameFlag, type AudioFrame } from "@homunculus/protocol";
import type { Pacer } from "../gateway/pacer.js";
import type { Logger } from "../log.js";
import type { OpusFramer } from "../speech/audio.js";
import type { TtsProvider } from "../speech/types.js";

/** Pacer item: one downlink frame plus control messages tied to its send time. */
export interface PacedItem {
  frame: Omit<AudioFrame, "type">;
  before?: () => void;
  after?: () => void;
}

export interface SpeechOutputDeps {
  tts: TtsProvider;
  voice: string;
  framer: OpusFramer;
  pacer: Pacer<PacedItem>;
  nextSegmentId(): number;
  /** Called right before the first frame of a segment is sent. */
  onSegmentStart(id: number, text: string, first: boolean): void;
  /** Called right after the last frame of a segment is sent. */
  onSegmentEnd(id: number): void;
  onFirstChunk(): void;
  log: Logger;
}

interface Segment {
  id: number;
  text: string;
  started: boolean;
  played: boolean;
}

export class SpeechOutput {
  readonly segments: Segment[] = [];
  /** performance.now() of the last enqueued segment. */
  lastEnqueuedAt: number | undefined;
  private queue: string[] = [];
  private running: Promise<void> | undefined;
  private readonly abort = new AbortController();
  private firstChunk = false;
  private playedWaiter: { id: number; resolve: () => void } | undefined;

  constructor(private readonly d: SpeechOutputDeps) {}

  get started(): boolean {
    return this.segments.some((s) => s.started);
  }

  get cancelled(): boolean {
    return this.abort.signal.aborted;
  }

  enqueue(text: string): void {
    if (this.cancelled) return;
    this.queue.push(text);
    this.lastEnqueuedAt = performance.now();
    this.running ??= this.loop();
  }

  /** Resolves once every enqueued segment is synthesised and its frames sent. */
  async finish(): Promise<void> {
    while (this.running) await this.running;
    if (!this.cancelled) await this.d.pacer.drained();
  }

  /** Waits for the device's tts.played of the last segment (spec §4.6), at most `timeoutMs`. */
  async lastPlayed(timeoutMs: number): Promise<void> {
    const last = this.segments.at(-1);
    if (!last || last.played) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.playedWaiter = {
        id: last.id,
        resolve: () => {
          clearTimeout(t);
          resolve();
        },
      };
    });
  }

  played(id: number): void {
    const s = this.segments.find((x) => x.id === id);
    if (s) s.played = true;
    if (this.playedWaiter?.id === id) this.playedWaiter.resolve();
  }

  /** Text the user has heard: played segments plus the one playing (spec §5.3.1 heardSoFar). */
  heardText(): string {
    return this.segments
      .filter((s) => s.played || s.started)
      .map((s) => s.text)
      .join(" ");
  }

  /** Barge-in: stops synthesis; the caller clears the pacer. */
  cancel(): void {
    this.queue = [];
    this.abort.abort();
    this.playedWaiter?.resolve();
  }

  private async loop(): Promise<void> {
    for (let text = this.queue.shift(); text !== undefined && !this.cancelled; text = this.queue.shift()) {
      try {
        await this.speak(text);
      } catch (e) {
        this.d.log.error("tts_failed", { error: (e as Error).message, text });
      }
    }
    // Cleared synchronously with the empty-queue check, so a concurrent enqueue starts a new loop.
    this.running = undefined;
  }

  private async speak(text: string): Promise<void> {
    const seg: Segment = { id: this.d.nextSegmentId(), text, started: false, played: false };
    const first = this.segments.length === 0;
    const t0 = performance.now();
    let seq = 0;
    let held: Uint8Array | undefined;
    let samples = 0;
    const push = (payload: Uint8Array, last: boolean) => {
      const isFirst = seq === 0;
      let flags = 0;
      if (isFirst) flags |= FrameFlag.First;
      if (last) flags |= FrameFlag.Last;
      if (isFirst) this.segments.push(seg);
      this.d.pacer.push({
        frame: { flags, streamId: seg.id & 0xffff, seq: seq++, payload },
        before: isFirst
          ? () => {
              seg.started = true;
              this.d.onSegmentStart(seg.id, seg.text, first);
            }
          : undefined,
        after: last ? () => this.d.onSegmentEnd(seg.id) : undefined,
      });
    };
    // One frame is held back so the last frame of the segment can carry the Last flag.
    const send = (frames: Uint8Array[]) => {
      for (const f of frames) {
        if (held) push(held, false);
        held = f;
      }
    };
    const { framer } = this.d;
    for await (const pcm of this.d.tts.synthesize(text, {
      voice: this.d.voice,
      sampleRate: framer.rate,
      signal: this.abort.signal,
    })) {
      if (this.cancelled) return;
      if (!this.firstChunk) {
        this.firstChunk = true;
        this.d.onFirstChunk();
      }
      samples += pcm.length;
      send(framer.push(pcm));
    }
    if (this.cancelled) return;
    send(framer.flush());
    if (held) push(held, true);
    this.d.log.info("tts_segment", {
      segment: seg.id,
      chars: text.length,
      synth_ms: Math.round(performance.now() - t0),
      audio_ms: Math.round((samples / framer.rate) * 1000),
      text,
    });
  }
}
