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
  /** Working directory for file-producing tools (per-device sandbox). */
  cwd?: string;
  /** Host-side tools exposed to the agent (device tools), with their permission policy. */
  tools?: HostTool[];
  /** Asks the user on the device to approve a tool call; resolves false on denial, timeout, abort. */
  confirm?: (req: ConfirmRequest, signal?: AbortSignal) => Promise<boolean>;
}

export interface HostTool {
  /** Agent-facing name, [A-Za-z0-9_-]. */
  name: string;
  description: string;
  /** JSON Schema of the arguments (object). */
  inputSchema: Record<string, unknown>;
  /** `ask`: every call needs `confirm` (spec §5.6). */
  policy: "allow" | "ask";
  call(args: unknown, signal?: AbortSignal): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  ok: boolean;
  text: string;
}

export interface ConfirmRequest {
  tool: string;
  title: string;
  detail: string;
  timeoutMs?: number;
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
  /** `fatal`: the session is unusable (process ended); the caller opens a new one. */
  | { type: "error"; message: string; retryable: boolean; fatal?: boolean };
