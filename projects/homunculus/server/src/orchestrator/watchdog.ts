// Inactivity watchdog for turn stages that wait on external components (STT, agent, TTS).

export class WatchdogError extends Error {
  override readonly name = "WatchdogError";
}

/**
 * Fires when `kick()` was not called for `ms`. `guard(p)` races a promise against the
 * watchdog, so a hung await turns into a WatchdogError instead of wedging the turn.
 */
export class Watchdog {
  private timer: NodeJS.Timeout | undefined;
  private fire!: (e: WatchdogError) => void;
  private stopped = false;
  readonly fired: Promise<never>;

  constructor(
    private readonly ms: number,
    private readonly what: string,
  ) {
    this.fired = new Promise<never>((_, reject) => (this.fire = reject));
    this.fired.catch(() => {});
    this.kick();
  }

  kick(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.stopped = true;
      this.fire(new WatchdogError(`${this.what}: no progress for ${this.ms} ms`));
    }, this.ms);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  guard<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.fired]);
  }
}

/** Resolves with `p`'s value, or undefined if `p` rejects or does not settle within `ms`. */
export function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.catch(() => undefined),
    new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), ms))),
  ]).finally(() => clearTimeout(timer));
}

/** Resolves true when `p` settles within `ms`, false otherwise. */
export function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms))),
  ]).finally(() => clearTimeout(timer));
}
