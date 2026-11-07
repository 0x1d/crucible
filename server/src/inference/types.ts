// Inference Abstraction Layer (spec §5.3.1).

export interface BackendCapabilities {
  streamingText: boolean;
  toolEvents: boolean;
  interrupt: boolean;
  sessions: boolean;
}

export interface AgentBackend {
  readonly id: string;
  capabilities(): BackendCapabilities;
  openSession(ctx: SessionContext): Promise<AgentSession>;
}

export interface SessionContext {
  systemPrompt: string;
  /** Backend-native session id to resume. */
  resumeSessionId?: string;
}

export interface AgentSession {
  /** Backend-native id, available once the backend has reported it. */
  readonly sessionId: string | undefined;
  send(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  /** Barge-in: stop the current turn; the session stays usable. */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export type AgentInput =
  | { kind: "utterance"; text: string; heardSoFar?: string }
  | { kind: "event"; name: string; data: unknown };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type AgentEvent =
  | { type: "status"; phase: "thinking" | "responding" }
  | { type: "text.delta"; text: string }
  | { type: "tool.start"; name: string; input?: unknown }
  | { type: "tool.end"; name: string; ok: boolean }
  | { type: "permission.request"; id: string; tool: string; summary: string }
  | { type: "done"; usage?: Usage; interrupted?: boolean }
  | { type: "error"; message: string; retryable: boolean };
