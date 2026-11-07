// Real-time pacing of downlink audio frames (spec §5.1, Device Gateway).
import { FRAME_MS } from "@homunculus/protocol";

export interface PacerOptions {
  frameMs?: number;
  /** Frames sent ahead of real time to fill the device jitter buffer. */
  prebufferFrames?: number;
}

/**
 * Sends queued frames at real-time rate. Frame i of a run is due at
 * start + (i - prebuffer) * frameMs, so the schedule does not drift.
 * Frames can be pushed while the pacer runs (TTS still synthesising);
 * if the queue ran dry long enough for the device buffer to empty, a new run starts.
 */
export class Pacer<T> {
  private queue: T[] = [];
  private timer: NodeJS.Timeout | undefined;
  private start = 0;
  private sent = 0;
  private drainWaiters: Array<() => void> = [];
  private readonly frameMs: number;
  private readonly prebuffer: number;

  constructor(
    private readonly sink: (frame: T) => void,
    opts: PacerOptions = {},
  ) {
    this.frameMs = opts.frameMs ?? FRAME_MS;
    this.prebuffer = opts.prebufferFrames ?? 3;
  }

  push(frame: T): void {
    if (this.queue.length === 0 && !this.timer) {
      const now = performance.now();
      // Device buffer has played out everything sent: start a new run with a fresh prebuffer.
      if (now > this.start + this.sent * this.frameMs) {
        this.start = now;
        this.sent = 0;
      }
    }
    this.queue.push(frame);
    if (!this.timer) this.tick();
  }

  /** Resolves once every frame pushed so far has been sent, or the pacer was cleared. */
  drained(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  /** Drops all pending frames (barge-in / abort). */
  clear(): void {
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.start = 0;
    this.sent = 0;
    this.notifyDrained();
  }

  get pending(): number {
    return this.queue.length;
  }

  private due(i: number): number {
    return this.start + (i - this.prebuffer) * this.frameMs;
  }

  private tick = (): void => {
    this.timer = undefined;
    while (this.queue.length > 0 && performance.now() >= this.due(this.sent)) {
      this.sink(this.queue.shift() as T);
      this.sent++;
    }
    if (this.queue.length === 0) {
      this.notifyDrained();
      return;
    }
    this.timer = setTimeout(this.tick, Math.max(0, this.due(this.sent) - performance.now()));
  };

  private notifyDrained(): void {
    const w = this.drainWaiters;
    this.drainWaiters = [];
    for (const r of w) r();
  }
}
