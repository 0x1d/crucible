// Claude Agent SDK backend (spec §5.3.2).
import { mkdirSync } from "node:fs";
import {
  query,
  type EffortLevel,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentBackend,
  AgentEvent,
  AgentInput,
  AgentSession,
  BackendCapabilities,
  SessionContext,
} from "../types.js";

export interface ClaudeBackendOptions {
  model: string;
  effort: EffortLevel;
  /** Built-in tools the agent may use without asking. */
  tools: string[];
  /** Working directory for file-producing tools (per-device sandbox). */
  cwd: string;
}

export class ClaudeAgentBackend implements AgentBackend {
  readonly id = "claude-agent-sdk";

  constructor(private readonly opts: ClaudeBackendOptions) {}

  capabilities(): BackendCapabilities {
    return { streamingText: true, toolEvents: true, interrupt: true, sessions: true };
  }

  async openSession(ctx: SessionContext): Promise<AgentSession> {
    return new ClaudeAgentSession(this.opts, ctx);
  }
}

/** Push-based async iterable feeding user messages into a long-lived query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter: ((r: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value: msg, done: false });
    } else {
      this.items.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiter = resolve));
      },
    };
  }
}

class ClaudeAgentSession implements AgentSession {
  private readonly input = new InputQueue();
  private readonly q: Query;
  private _sessionId: string | undefined;
  private interrupted = false;
  private busy = false;

  constructor(opts: ClaudeBackendOptions, ctx: SessionContext) {
    mkdirSync(opts.cwd, { recursive: true });
    this.q = query({
      prompt: this.input,
      options: {
        model: opts.model,
        effort: opts.effort,
        systemPrompt: ctx.systemPrompt,
        tools: opts.tools,
        allowedTools: opts.tools,
        permissionMode: "dontAsk",
        // Don't inherit the host user's Claude Code settings, CLAUDE.md or plugins.
        settingSources: [],
        includePartialMessages: true,
        cwd: opts.cwd,
        ...(ctx.resumeSessionId ? { resume: ctx.resumeSessionId } : {}),
      },
    });
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async *send(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (this.busy) throw new Error("turn already in progress");
    this.busy = true;
    this.interrupted = false;
    const onAbort = () => void this.interrupt();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      this.input.push(toUserMessage(input));
      yield { type: "status", phase: "thinking" };
      let responding = false;
      while (true) {
        const next = await this.q.next();
        if (next.done) {
          yield { type: "error", message: "agent process ended", retryable: true };
          return;
        }
        const msg = next.value;
        this._sessionId ??= "session_id" in msg ? msg.session_id : undefined;
        for (const ev of mapMessage(msg)) {
          if (ev.type === "text.delta" && !responding) {
            responding = true;
            yield { type: "status", phase: "responding" };
          }
          yield ev;
        }
        if (msg.type === "result") {
          const usage = {
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            costUsd: msg.total_cost_usd,
          };
          if (msg.subtype === "success" || this.interrupted) {
            yield { type: "done", usage, interrupted: this.interrupted };
          } else {
            yield { type: "error", message: msg.subtype, retryable: false };
          }
          return;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.busy = false;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.busy) return;
    this.interrupted = true;
    await this.q.interrupt();
  }

  async close(): Promise<void> {
    this.input.close();
    this.q.close();
  }
}

function toUserMessage(input: AgentInput): SDKUserMessage {
  let text: string;
  if (input.kind === "utterance") {
    if (input.heardSoFar === undefined) text = input.text;
    else if (input.heardSoFar === "") {
      text = `(The user interrupted your previous answer before hearing any of it.)\n\n${input.text}`;
    } else {
      text = `(The user interrupted your previous answer; they only heard: "${input.heardSoFar}")\n\n${input.text}`;
    }
  } else {
    text = `[device event: ${input.name}] ${JSON.stringify(input.data)}`;
  }
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function* mapMessage(msg: SDKMessage): Generator<AgentEvent> {
  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      yield { type: "text.delta", text: ev.delta.text };
    } else if (
      ev.type === "content_block_start" &&
      (ev.content_block.type === "tool_use" || ev.content_block.type === "server_tool_use")
    ) {
      yield { type: "tool.start", name: ev.content_block.name };
    }
  } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
    for (const block of msg.message.content) {
      if (block.type === "tool_result") {
        yield { type: "tool.end", name: block.tool_use_id, ok: !block.is_error };
      }
    }
  }
}
