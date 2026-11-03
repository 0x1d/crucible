/** Normalized stream that every host adapter produces for the TUI. */
export type HostEvent =
  | { type: "user"; text: string }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  /**
   * `costUsd` is the running cost total of the whole session, not the cost of one turn.
   * `cacheReadTokens` is present when the host reported a prompt cache.
   * A read above zero is a hit. A reported read of zero is a miss.
   */
  | {
      type: "usage";
      contextTokens?: number;
      contextWindow?: number;
      costUsd?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface ModelChoice {
  id: string;
  label: string;
  efforts: string[];
}

export interface HostAdapter {
  readonly name: string;
  readonly sessionId: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  listSessions(): Promise<SessionSummary[]>;
  /** Opens a session and returns its replayed events. `undefined` starts a new session. */
  openSession(id: string | undefined): Promise<HostEvent[]>;
  listModels(): Promise<ModelChoice[]>;
  setModel(model: string | undefined, effort: string | undefined): void;
  send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent>;
  close(): Promise<void>;
}
