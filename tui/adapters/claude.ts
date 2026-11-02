import {
  type EffortLevel,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  getSessionMessages,
  listSessions,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../../core/elixir-bridge.ts";
import { alchemistOptions } from "../../hosts/claude/codex.ts";
import type { HostAdapter, HostEvent, ModelChoice, SessionSummary } from "./types.ts";

const TOOL_PREFIX = "mcp__alchemist__";
/** How long a stopped turn may take to deliver its `result` before the process is replaced. */
export const INTERRUPT_GRACE_MS = 10_000;

// The SDK message types are wide unions. The mapping reads only these fields.
type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | Block[];
};
type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};
type RawMessage = {
  type: string;
  subtype?: string;
  parent_tool_use_id?: string | null;
  session_id?: string;
  event?: { type: string; delta?: { type: string; text?: string; thinking?: string } };
  message?: unknown;
  total_cost_usd?: number;
  modelUsage?: Record<string, { contextWindow?: number }>;
  errors?: string[];
};

function contextTokens(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

function blockText(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => b.text ?? "").join("");
}

function contentOf(message: unknown): string | Block[] {
  return (message as { content?: string | Block[] } | undefined)?.content ?? [];
}

function toolEvent(block: Block): HostEvent {
  const name = (block.name ?? "").replace(TOOL_PREFIX, "");
  return { type: "tool", id: block.id ?? "", name, input: block.input };
}

function toolResults(message: unknown): HostEvent[] {
  const content = contentOf(message);
  if (typeof content === "string") return [];
  return content
    .filter((b) => b.type === "tool_result")
    .map((b) => ({
      type: "tool_result",
      id: b.tool_use_id ?? "",
      ok: !b.is_error,
      output: blockText(b.content),
    }));
}

/** Maps one live SDK message to TUI events. Text arrives through stream events only. */
export function mapClaudeMessage(raw: unknown): HostEvent[] {
  const m = raw as RawMessage;
  if (m.parent_tool_use_id) return [];
  switch (m.type) {
    case "stream_event": {
      const delta = m.event?.type === "content_block_delta" ? m.event.delta : undefined;
      if (delta?.type === "text_delta") return [{ type: "text", delta: delta.text ?? "" }];
      if (delta?.type === "thinking_delta") return [{ type: "reasoning", delta: delta.thinking ?? "" }];
      return [];
    }
    case "assistant": {
      const content = contentOf(m.message);
      const events: HostEvent[] = typeof content === "string" ? [] : content.filter((b) => b.type === "tool_use").map(toolEvent);
      const usage = (m.message as { usage?: Usage } | undefined)?.usage;
      if (usage) events.push({ type: "usage", contextTokens: contextTokens(usage) });
      return events;
    }
    case "user":
      return toolResults(m.message);
    case "result": {
      const windows = Object.values(m.modelUsage ?? {}).map((u) => u.contextWindow ?? 0);
      const usage: HostEvent = { type: "usage", costUsd: m.total_cost_usd ?? 0 };
      if (windows.length > 0) usage.contextWindow = Math.max(...windows);
      if (m.subtype === "success") return [usage, { type: "done", sessionId: m.session_id ?? "" }];
      return [usage, { type: "error", message: (m.errors ?? [m.subtype ?? "error"]).join("\n") }];
    }
    default:
      return [];
  }
}

/** Maps a stored transcript to TUI events for replay. */
export function mapSessionMessages(messages: unknown[]): HostEvent[] {
  const events: HostEvent[] = [];
  for (const raw of messages) {
    const m = raw as RawMessage;
    if (m.parent_tool_use_id) continue;
    const content = contentOf(m.message);
    if (m.type === "user") {
      const results = toolResults(m.message);
      if (results.length > 0) events.push(...results);
      else events.push({ type: "user", text: blockText(content) });
    } else if (m.type === "assistant" && typeof content !== "string") {
      for (const block of content) {
        if (block.type === "thinking") events.push({ type: "reasoning", delta: block.thinking ?? "" });
        else if (block.type === "text") events.push({ type: "text", delta: block.text ?? "" });
        else if (block.type === "tool_use") events.push(toolEvent(block));
      }
      const usage = (m.message as { usage?: Usage }).usage;
      if (usage) events.push({ type: "usage", contextTokens: contextTokens(usage) });
    }
  }
  return events;
}

/** Ids of the Claude sessions that the TUI created, in creation order. */
export class SessionIndex {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  ids(): Set<string> {
    try {
      return new Set(JSON.parse(fs.readFileSync(this.file, "utf8")) as string[]);
    } catch {
      return new Set();
    }
  }

  add(id: string): void {
    const ids = this.ids();
    if (ids.has(id)) return;
    ids.add(id);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify([...ids], null, 2)}\n`);
  }
}

/**
 * A push-based async iterable. The live Claude query reads its user messages from it,
 * so one CLI process serves every turn of a session.
 */
export class MessageQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | undefined;
  private ended = false;

  push(item: T): void {
    if (this.ended) throw new Error("The message queue has ended.");
    const waiting = this.waiting;
    this.waiting = undefined;
    if (waiting) waiting({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Reads the next message of a turn. After the turn is stopped, it waits at most
 * `graceMs` per message and returns `undefined` when the time runs out.
 */
export async function nextTurnMessage<T>(
  messages: AsyncIterator<T>,
  aborted: Promise<void>,
  signal: AbortSignal,
  graceMs = INTERRUPT_GRACE_MS,
): Promise<IteratorResult<T> | undefined> {
  const pending = messages.next();
  if (!signal.aborted) {
    const first = await Promise.race([pending, aborted.then(() => undefined)]);
    if (first !== undefined) return first;
  }
  return withTimeout(pending, graceMs);
}

function userMessage(prompt: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null };
}

type LiveQuery = { query: Query; input: MessageQueue<SDKUserMessage> };

/**
 * Claude host adapter.
 *
 * One `query()` in streaming input mode serves the whole session: the CLI process,
 * its MCP connections, and its prompt cache prefix stay the same from turn to turn.
 * A new process starts only for a different session, after a failure, or when a
 * stopped turn does not finish in time. It resumes the session from its transcript.
 */
export class ClaudeAdapter implements HostAdapter {
  readonly name = "claude";
  sessionId: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  private models: ModelChoice[] | undefined;
  private live: LiveQuery | undefined;
  /** Model and effort changes that are still being applied to the live query. */
  private settings: Promise<void> = Promise.resolve();
  private readonly index = new SessionIndex(
    path.join(repoRoot, ".alchemist/tui/claude-sessions.json"),
  );

  /** Starts the session process, or returns the running one. */
  private start(): LiveQuery {
    if (this.live) return this.live;
    const input = new MessageQueue<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        ...alchemistOptions(),
        resume: this.sessionId,
        includePartialMessages: true,
        model: this.model,
        effort: this.effort as EffortLevel | undefined,
      },
    });
    this.live = { query: q, input };
    this.settings = Promise.resolve();
    return this.live;
  }

  /** Ends the session process. The next turn starts a new one that resumes the session. */
  private stop(): void {
    const live = this.live;
    this.live = undefined;
    if (!live) return;
    live.input.end();
    live.query.close();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const ids = this.index.ids();
    const sessions = await listSessions({ dir: repoRoot });
    return sessions
      .filter((s) => ids.has(s.sessionId))
      .sort((a, b) => b.lastModified - a.lastModified)
      .map((s) => ({
        id: s.sessionId,
        title: s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId,
        updatedAt: new Date(s.lastModified),
      }));
  }

  async openSession(id: string | undefined): Promise<HostEvent[]> {
    // A different session, or a new one, needs its own process. Reopening the live session keeps it.
    if (!(id && id === this.sessionId && this.live)) this.stop();
    this.sessionId = id;
    // Start the process now, so it boots while the transcript loads and the user types.
    this.start();
    if (!id) return [];
    return mapSessionMessages(await getSessionMessages(id, { dir: repoRoot }));
  }

  async listModels(): Promise<ModelChoice[]> {
    if (!this.models) {
      const models = await this.start().query.supportedModels();
      this.models = models.map((m) => ({
        id: m.value,
        label: m.displayName,
        efforts: m.supportedEffortLevels ?? [],
      }));
    }
    return this.models;
  }

  setModel(model: string | undefined, effort: string | undefined): void {
    const modelChanged = model !== this.model;
    const effortChanged = effort !== this.effort;
    this.model = model;
    this.effort = effort;
    const live = this.live;
    if (!live || (!modelChanged && !effortChanged)) return;
    // The live process switches in place. If that fails, the next turn starts a new
    // process with the new options.
    this.settings = this.settings
      .then(async () => {
        if (modelChanged) await live.query.setModel(model);
        if (effortChanged) {
          await live.query.applyFlagSettings({ effortLevel: (effort ?? null) as EffortLevel | null });
        }
      })
      .catch(() => {
        if (this.live === live) this.stop();
      });
  }

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent> {
    await this.settings;
    const live = this.start();
    let finished = false;
    const aborted = new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // Stopping interrupts the turn. The process stays up and still sends the turn's `result`.
    void aborted.then(() => {
      if (!finished && this.live === live) live.query.interrupt().catch(() => undefined);
    });
    try {
      live.input.push(userMessage(prompt));
      for (;;) {
        const next = await nextTurnMessage<SDKMessage>(live.query, aborted, signal);
        if (next === undefined) {
          // The stopped turn did not finish in time.
          this.stop();
          return;
        }
        if (next.done) {
          this.stop();
          if (!signal.aborted) yield { type: "error", message: "The Claude process ended before the turn finished." };
          return;
        }
        const message = next.value;
        if (message.type === "result") {
          this.sessionId = message.session_id;
          this.index.add(message.session_id);
        }
        for (const event of mapClaudeMessage(message)) {
          // A stopped turn ends with an error result. The TUI already reports the stop.
          if (signal.aborted && event.type === "error") continue;
          yield event;
        }
        if (message.type === "result") {
          finished = true;
          return;
        }
      }
    } catch (error) {
      this.stop();
      if (!signal.aborted) yield { type: "error", message: String(error) };
    } finally {
      // A turn that ends without its `result` would leave messages for the next turn.
      if (!finished) this.stop();
      finished = true;
    }
  }

  async close(): Promise<void> {
    this.stop();
  }
}
