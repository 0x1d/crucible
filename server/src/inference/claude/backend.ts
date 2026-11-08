// Claude Agent SDK backend (spec §5.3.2).
import { mkdirSync } from "node:fs";
import { z } from "zod";
import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
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
  HostTool,
  SessionContext,
} from "../types.js";

const DEVICE_SERVER = "device";
export const hostToolId = (server: string, name: string) => `mcp__${server}__${name}`;

/** Host tool servers of a session: `device` (bridge, spec §5.6) plus `ctx.servers`. */
function hostServers(ctx: SessionContext): Record<string, HostTool[]> {
  const out: Record<string, HostTool[]> = {};
  if (ctx.tools?.length) out[DEVICE_SERVER] = ctx.tools;
  for (const [name, tools] of Object.entries(ctx.servers ?? {})) if (tools.length) out[name] = tools;
  return out;
}

/** In-process MCP server exposing host tools. */
export function hostToolServer(name: string, tools: HostTool[]) {
  return createSdkMcpServer({
    name,
    tools: tools.map((t) => {
      const schema = z.fromJSONSchema(t.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      const shape = schema instanceof z.ZodObject ? schema.shape : {};
      return tool(t.name, t.description, shape, async (args, extra) => {
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
        const r = await t.call(args, signal);
        return { content: [{ type: "text" as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
      });
    }),
  });
}

/** Allows `ask` host tools after on-device confirmation; everything else not pre-allowed is denied. */
function permissionGate(ctx: SessionContext): CanUseTool {
  const asks = new Map(
    Object.entries(hostServers(ctx)).flatMap(([server, tools]) =>
      tools.filter((t) => t.policy === "ask").map((t) => [hostToolId(server, t.name), t] as const),
    ),
  );
  return async (toolName, input, { signal }) => {
    const t = asks.get(toolName);
    if (!t || !ctx.confirm) return { behavior: "deny", message: `${toolName} is not permitted` };
    const approved = await ctx.confirm(
      { tool: t.name, title: t.description.slice(0, 80), detail: JSON.stringify(input).slice(0, 200) },
      signal,
    );
    return approved
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "the user declined on the device" };
  };
}

export interface ClaudeBackendOptions {
  model: string;
  effort: EffortLevel;
  /** Built-in tools the agent may use without asking. */
  tools: string[];
  /** Default working directory; SessionContext.cwd overrides it per session. */
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
  private ended = false;

  constructor(opts: ClaudeBackendOptions, ctx: SessionContext) {
    const cwd = ctx.cwd ?? opts.cwd;
    mkdirSync(cwd, { recursive: true });
    const servers = hostServers(ctx);
    const entries = Object.entries(servers);
    const preAllowed = entries.flatMap(([server, tools]) =>
      tools.filter((t) => t.policy === "allow").map((t) => hostToolId(server, t.name)),
    );
    const hasAsk = entries.some(([, tools]) => tools.some((t) => t.policy === "ask"));
    this.q = query({
      prompt: this.input,
      options: {
        model: opts.model,
        effort: opts.effort,
        systemPrompt: ctx.systemPrompt,
        tools: opts.tools,
        allowedTools: [...opts.tools, ...preAllowed],
        ...(entries.length
          ? {
              mcpServers: Object.fromEntries(entries.map(([name, tools]) => [name, hostToolServer(name, tools)])),
              canUseTool: permissionGate(ctx),
            }
          : {}),
        permissionMode: hasAsk ? "default" : "dontAsk",
        // Don't inherit the host user's Claude Code settings, CLAUDE.md or plugins; no Claude Code
        // auto-memory (it would load the host user's MEMORY.md of the enclosing git repo).
        settingSources: [],
        settings: { autoMemoryEnabled: false },
        env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
        includePartialMessages: true,
        cwd,
        ...(ctx.resumeSessionId ? { resume: ctx.resumeSessionId } : {}),
      },
    });
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async *send(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (this.ended) {
      yield { type: "error", message: "agent process ended", retryable: true, fatal: true };
      return;
    }
    if (this.busy) throw new Error("turn already in progress");
    this.busy = true;
    this.interrupted = false;
    const onAbort = () => void this.interrupt();  // interrupt() never rejects
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      this.input.push(toUserMessage(input));
      yield { type: "status", phase: "thinking" };
      let responding = false;
      while (true) {
        let next: IteratorResult<SDKMessage, void>;
        try {
          next = await this.q.next();
        } catch (e) {
          this.ended = true;
          yield { type: "error", message: `agent process failed: ${(e as Error).message}`, retryable: true, fatal: true };
          return;
        }
        if (next.done) {
          this.ended = true;
          yield { type: "error", message: "agent process ended", retryable: true, fatal: true };
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
    try {
      await this.q.interrupt();
    } catch {
      // Query closed or CLI already idle: nothing left to interrupt.
    }
  }

  async close(): Promise<void> {
    this.ended = true;
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
    if (input.context) text = `<memory-context>\n${input.context}\n</memory-context>\n\n${text}`;
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
