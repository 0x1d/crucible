import {
  type EffortLevel,
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

async function* idle(): AsyncGenerator<SDKUserMessage> {
  await new Promise(() => {});
}

export class ClaudeAdapter implements HostAdapter {
  readonly name = "claude";
  sessionId: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  private models: ModelChoice[] | undefined;
  private readonly index = new SessionIndex(
    path.join(repoRoot, ".alchemist/tui/claude-sessions.json"),
  );

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
    this.sessionId = id;
    if (!id) return [];
    return mapSessionMessages(await getSessionMessages(id, { dir: repoRoot }));
  }

  async listModels(): Promise<ModelChoice[]> {
    if (!this.models) {
      const q = query({ prompt: idle(), options: alchemistOptions() });
      try {
        const models = await q.supportedModels();
        this.models = models.map((m) => ({
          id: m.value,
          label: m.displayName,
          efforts: m.supportedEffortLevels ?? [],
        }));
      } finally {
        q.close();
      }
    }
    return this.models;
  }

  setModel(model: string | undefined, effort: string | undefined): void {
    this.model = model;
    this.effort = effort;
  }

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent> {
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort(), { once: true });
    const q = query({
      prompt,
      options: {
        ...alchemistOptions(),
        resume: this.sessionId,
        includePartialMessages: true,
        abortController,
        model: this.model,
        effort: this.effort as EffortLevel | undefined,
      },
    });
    try {
      for await (const message of q) {
        if (message.type === "result") {
          this.sessionId = message.session_id;
          this.index.add(message.session_id);
        }
        yield* mapClaudeMessage(message);
      }
    } catch (error) {
      if (!signal.aborted) yield { type: "error", message: String(error) };
    }
  }

  async close(): Promise<void> {}
}
