import type { HostEvent } from "./adapters/types.ts";

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(Math.round(k * 10) / 10) ? Math.round(k) : k.toFixed(1)}k`;
}

/** Token, context, and cost totals of one session. */
export class SessionStats {
  contextTokens = 0;
  contextWindow: number | undefined;
  /** Tokens read from the prompt cache on the last turn that reported a cache. */
  cacheReadTokens: number | undefined;
  /** Tokens written into the prompt cache on that same turn. */
  cacheWriteTokens: number | undefined;
  /** The session's running cost total, as last reported by the host. */
  costUsd = 0;
  /** False when part of the session cost is unknown: after a replay, until the first live total arrives. */
  costComplete = true;
  lastTurnMs: number | undefined;

  static fromReplay(events: HostEvent[]): SessionStats {
    const stats = new SessionStats();
    for (const event of events) stats.apply(event);
    if (!events.some((e) => e.type === "usage" && e.costUsd !== undefined)) {
      stats.costComplete = false;
    }
    return stats;
  }

  apply(event: HostEvent): void {
    if (event.type !== "usage") return;
    if (event.contextTokens !== undefined) this.contextTokens = event.contextTokens;
    if (event.contextWindow !== undefined) this.contextWindow = event.contextWindow;
    if (event.cacheReadTokens !== undefined) this.cacheReadTokens = event.cacheReadTokens;
    if (event.cacheWriteTokens !== undefined) this.cacheWriteTokens = event.cacheWriteTokens;
    // Hosts report a running total for the whole session, so the latest value replaces the old one.
    // A live total also covers the turns before a replay, so the cost is then complete.
    if (event.costUsd !== undefined) {
      this.costUsd = event.costUsd;
      this.costComplete = true;
    }
  }

  contextRatio(): number | undefined {
    return this.contextWindow ? this.contextTokens / this.contextWindow : undefined;
  }

  /** True when this turn read from the prompt cache. Undefined until a host reports cache counters. */
  cacheHit(): boolean | undefined {
    if (this.cacheReadTokens === undefined) return undefined;
    return this.cacheReadTokens > 0;
  }

  /** Cache read plus cache write. Undefined until a host reports cache counters. */
  cachedTokens(): number | undefined {
    if (this.cacheReadTokens === undefined) return undefined;
    return this.cacheReadTokens + (this.cacheWriteTokens ?? 0);
  }

  /** Prompt tokens that were not served from or written to the cache. */
  newTokens(): number | undefined {
    const cached = this.cachedTokens();
    if (cached === undefined) return undefined;
    return Math.max(0, this.contextTokens - cached);
  }

  contextLabel(): string {
    const ratio = this.contextRatio();
    const used = formatTokens(this.contextTokens);
    if (ratio === undefined || this.contextWindow === undefined) return `ctx ${used}`;
    return `ctx ${used}/${formatTokens(this.contextWindow)} (${Math.round(ratio * 100)}%)`;
  }

  costLabel(): string {
    return `${this.costComplete ? "" : "~"}$${this.costUsd.toFixed(3)}`;
  }

  turnLabel(): string | undefined {
    return this.lastTurnMs === undefined ? undefined : `${(this.lastTurnMs / 1000).toFixed(1)}s`;
  }
}
