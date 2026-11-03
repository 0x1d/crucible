import { serve, type AgentServeHandle } from "@grok/agent-sdk";
import path from "node:path";
import { repoRoot } from "../../core/elixir-bridge.ts";
import { nextTurnMessage } from "./claude.ts";
import type { HostAdapter, HostEvent, ModelChoice, SessionSummary } from "./types.ts";

/** Model `auto` reports no window. The footer uses this fixed size. */
export const CURSOR_CONTEXT_WINDOW = 200_000;

const EFFORTS = ["low", "medium", "high"];

/** Models the picker offers. `/model <id>` still accepts any other id. */
export const CURSOR_MODELS: ModelChoice[] = [
  { id: "auto", label: "Auto", efforts: EFFORTS },
  { id: "composer-2.5", label: "Composer 2.5", efforts: EFFORTS },
  { id: "grok-4.7", label: "Grok 4.7", efforts: EFFORTS },
];

const hostDir = path.join(repoRoot, "hosts/cursor");

type Usage = {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

type ToolCall = { callId?: string; toolName?: string; args?: unknown; parentCallId?: string };

/** The fields the mapper reads. The session event union is wider than this. */
type CursorEvent = {
  type?: string;
  index?: number;
  sessionId?: string;
  data?: {
    parentCallId?: string;
    delta?: string;
    text?: string;
    calls?: ToolCall[];
    callId?: string;
    toolName?: string;
    output?: unknown;
    isError?: boolean;
    usage?: Usage;
    message?: string;
  };
};

type ModelConfigMode = "unknown" | "on" | "off";

/**
 * Prompt size of one Cursor turn.
 *
 * Grok, xAI, and GPT report `inputTokens` already including cache read and
 * cache write. Adding those buckets again prints about twice the prompt, which
 * is how a 189k cached turn showed up as 376k in a 200k window. When input is
 * smaller than the cache buckets, the counters are disjoint and the prompt is
 * their sum, as on Claude.
 */
export function contextTokens(usage: Usage): number {
  const input = usage.inputTokens ?? 0;
  const cached = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (cached === 0 || input < cached) return input + cached;
  return input;
}

/** Index to pass as `startIndex` so a later read does not replay these events. */
export function resumeIndex(events: { index?: number }[]): number {
  let next = 0;
  for (const event of events) {
    if (typeof event.index === "number" && event.index + 1 > next) next = event.index + 1;
  }
  return next;
}

function effortParam(model: string): string {
  return model.includes("gpt") ? "reasoning" : "reasoning_effort";
}

/**
 * Model override for a new session.
 * Follow-ups omit this: the server freezes the model at create, and a later
 * change would miss that prefix and break the prompt cache.
 */
export function modelConfig(
  model: string | undefined,
  effort: string | undefined,
): { model: { id: string; params: { id: string; value: string }[] } } | undefined {
  if (!model) return undefined;
  return {
    model: {
      id: model,
      params: [
        { id: effortParam(model), value: effort ?? "high" },
        { id: "fast", value: "true" },
      ],
    },
  };
}

/** Body of `POST /v1/session`. Only the new prompt, never the transcript. */
export function createBody(
  message: string,
  model: string | undefined,
  effort: string | undefined,
): { message: string; modelConfig?: ReturnType<typeof modelConfig> } {
  const config = modelConfig(model, effort);
  return config ? { message, modelConfig: config } : { message };
}

/**
 * Body of a follow-up. The continuation token addresses the stored agent.
 * The server resumes that agent and sends only this message.
 */
export function followUpBody(continuationToken: string, message: string): {
  continuationToken: string;
  message: string;
} {
  return { continuationToken, message };
}

function outputText(output: unknown): string {
  if (output === undefined) return "";
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

function nested(event: CursorEvent): boolean {
  return Boolean(event.data?.parentCallId);
}

function usageEvent(usage: Usage | undefined): HostEvent {
  const event: HostEvent = { type: "usage", contextWindow: CURSOR_CONTEXT_WINDOW };
  if (usage) event.contextTokens = contextTokens(usage);
  return event;
}

/** Maps one live session event. Text comes from deltas, so a completed message is not repeated. */
export function mapCursorEvent(raw: unknown): HostEvent[] {
  const event = raw as CursorEvent;
  if (nested(event)) return [];
  const data = event.data ?? {};
  switch (event.type) {
    case "message.appended":
      return data.delta ? [{ type: "text", delta: data.delta }] : [];
    case "reasoning.appended":
      return data.delta ? [{ type: "reasoning", delta: data.delta }] : [];
    case "actions.requested":
      return (data.calls ?? [])
        .filter((call) => !call.parentCallId)
        .map((call) => ({
          type: "tool",
          id: call.callId ?? "",
          name: call.toolName ?? "",
          input: call.args,
        }));
    case "action.result":
      return [
        {
          type: "tool_result",
          id: data.callId ?? "",
          ok: data.isError !== true,
          output: outputText(data.output),
        },
      ];
    case "turn.completed":
      return [usageEvent(data.usage), { type: "done", sessionId: event.sessionId ?? "" }];
    case "turn.failed":
      return [{ type: "error", message: data.message ?? "The turn failed." }];
    default:
      return [];
  }
}

/** Maps a stored event log for replay. User prompts come from `message.received` only. */
export function mapCursorEvents(events: unknown[]): HostEvent[] {
  const mapped: HostEvent[] = [];
  for (const raw of events) {
    const event = raw as CursorEvent;
    if (nested(event)) continue;
    if (event.type === "message.received") {
      mapped.push({ type: "user", text: event.data?.text ?? "" });
      continue;
    }
    mapped.push(...mapCursorEvent(raw));
  }
  return mapped;
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as { message?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
  }
  return `HTTP ${status}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function* ndjson(response: Response): AsyncGenerator<CursorEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // The turn reader stops the stream on purpose. Ending the iterator
        // settles that read instead of rejecting it later.
        if (isAbortError(error)) return;
        throw error;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as CursorEvent;
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as CursorEvent;
  } finally {
    reader.releaseLock();
  }
}

type ListedSession = {
  sessionId?: string;
  title?: string;
  updatedAt?: string;
  continuationToken?: string | null;
  mode?: string;
};

type SubmitResult = { ok: true; modelFallback: boolean } | { ok: false; message: string };

/**
 * Cursor host adapter.
 *
 * One `serve()` process stays up for the life of the adapter. The runner keeps
 * the Cursor agent handle, and a follow-up posts only the new prompt plus the
 * current continuation token. The agent resumes from its store, so the prompt
 * cache prefix is the same conversation, not a transcript pasted into a new
 * session. The event stream is read from the last index plus 1.
 *
 * A new session starts for `/new`, for another selected session, or when a
 * model change can actually be stored on create. Changing the model does not
 * restart the open agent while the session API rejects `modelConfig`.
 */
export class CursorAdapter implements HostAdapter {
  readonly name = "cursor";
  sessionId: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  private continuationToken: string | undefined;
  private nextIndex = 0;
  /** `on` once a create with `modelConfig` is accepted. `off` once the API rejects it. */
  private modelConfigMode: ModelConfigMode = "unknown";
  private starting: Promise<AgentServeHandle> | undefined;

  /** Starts the in-process server, or returns the running one. */
  private server(): Promise<AgentServeHandle> {
    if (!this.starting) {
      this.starting = serve(hostDir, {
        mode: "single",
        port: 0,
        host: "127.0.0.1",
        // Dev mode stays off. It would mount the playground and, on a server
        // build that honors it, shorten the workspace scan cache that feeds
        // the prompt prefix. Schedules stay off so this process does not
        // start background sessions.
        playground: false,
        docs: false,
        schedules: false,
        reminders: false,
        stateRoot: path.join(hostDir, ".agent-serve"),
      }).catch((error: unknown) => {
        this.starting = undefined;
        throw error;
      });
    }
    return this.starting;
  }

  private async request(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    const response = await fetch(url, init);
    return { status: response.status, body: await readJson(response) };
  }

  private async sessions(): Promise<ListedSession[]> {
    const handle = await this.server();
    const { status, body } = await this.request(`${handle.url}/v1/sessions`);
    if (status !== 200) throw new Error(errorText(body, status));
    const listed = (body as { sessions?: ListedSession[] }).sessions;
    return Array.isArray(listed) ? listed : [];
  }

  private async tokenFor(id: string): Promise<string | undefined> {
    const session = (await this.sessions()).find((item) => item.sessionId === id);
    return typeof session?.continuationToken === "string" ? session.continuationToken : undefined;
  }

  /** Ends the open conversation without stopping the server. The next send creates a session. */
  private detachSession(): void {
    this.sessionId = undefined;
    this.continuationToken = undefined;
    this.nextIndex = 0;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = await this.sessions();
    return sessions
      .filter((session) => session.mode !== "task" && typeof session.sessionId === "string")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .map((session) => ({
        id: session.sessionId as string,
        title: session.title?.trim() || (session.sessionId as string),
        updatedAt: new Date(session.updatedAt ?? 0),
      }));
  }

  async openSession(id: string | undefined): Promise<HostEvent[]> {
    // Boot the server while the transcript loads and the user types.
    // Switching sessions does not restart it, so cached agent handles stay warm.
    const handle = await this.server();
    if (!id) {
      this.detachSession();
      return [];
    }
    const response = await fetch(
      `${handle.url}/v1/session/${encodeURIComponent(id)}/events?format=json`,
    );
    const body = await readJson(response);
    if (response.status !== 200) throw new Error(errorText(body, response.status));
    const events = (body as { events?: unknown[] }).events;
    if (!Array.isArray(events)) throw new Error("The session event log has no events array.");
    const continuationToken = await this.tokenFor(id);
    this.sessionId = id;
    this.continuationToken = continuationToken;
    this.nextIndex = resumeIndex(events as { index?: number }[]);
    return mapCursorEvents(events);
  }

  async listModels(): Promise<ModelChoice[]> {
    return CURSOR_MODELS.map((model) => ({ ...model, efforts: [...model.efforts] }));
  }

  setModel(model: string | undefined, effort: string | undefined): void {
    const changed = model !== this.model || effort !== this.effort;
    this.model = model;
    this.effort = effort;
    // Detach only when a previous create stored modelConfig. Otherwise the
    // open agent is the cached conversation, and a new session would not
    // change its model.
    if (changed && this.sessionId && this.modelConfigMode === "on") this.detachSession();
  }

  private async stopTurn(base: string, id: string): Promise<void> {
    await fetch(`${base}/v1/session/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  }

  private async readCost(base: string, id: string): Promise<number | undefined> {
    try {
      const response = await fetch(`${base}/v1/session/${encodeURIComponent(id)}/cost`, {
        signal: AbortSignal.timeout(8_000),
      });
      const body = await readJson(response);
      const status = response.status;
      if (status !== 200) return undefined;
      const report = body as { source?: string; costUsd?: number };
      if (report.source === "unavailable" || typeof report.costUsd !== "number") return undefined;
      return report.costUsd;
    } catch {
      return undefined;
    }
  }

  private noteIndex(event: CursorEvent): void {
    if (typeof event.index === "number" && event.index + 1 > this.nextIndex) {
      this.nextIndex = event.index + 1;
    }
  }

  private async create(base: string, prompt: string): Promise<SubmitResult> {
    const send = (withModel: boolean) =>
      this.request(`${base}/v1/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBody(prompt, withModel ? this.model : undefined, this.effort)),
      });
    const useModel = this.model !== undefined && this.modelConfigMode !== "off";
    let { status, body } = await send(useModel);
    let modelFallback = false;
    if (useModel && status === 400 && errorText(body, status).includes("modelConfig requires dryRun")) {
      this.modelConfigMode = "off";
      modelFallback = true;
      ({ status, body } = await send(false));
    }
    if (status !== 200) return { ok: false, message: errorText(body, status) };
    const created = body as { sessionId?: string; continuationToken?: string };
    if (!created.sessionId || !created.continuationToken) {
      return { ok: false, message: "The session response had no session id." };
    }
    if (useModel && !modelFallback) this.modelConfigMode = "on";
    this.sessionId = created.sessionId;
    this.continuationToken = created.continuationToken;
    this.nextIndex = 0;
    return { ok: true, modelFallback };
  }

  private async followUp(base: string, prompt: string): Promise<SubmitResult> {
    const id = this.sessionId;
    let token = this.continuationToken;
    if (!id || !token) return { ok: false, message: "This session has no continuation token." };
    for (let attempt = 0; attempt < 2; attempt++) {
      const { status, body } = await this.request(`${base}/v1/session/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(followUpBody(token, prompt)),
      });
      if (status === 409 && attempt === 0) {
        const fresh = await this.tokenFor(id);
        if (fresh && fresh !== token) {
          token = fresh;
          this.continuationToken = fresh;
          continue;
        }
      }
      if (status !== 200) return { ok: false, message: errorText(body, status) };
      const next = (body as { continuationToken?: string }).continuationToken;
      if (typeof next === "string") this.continuationToken = next;
      return { ok: true, modelFallback: false };
    }
    return { ok: false, message: "The continuation token was rejected." };
  }

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent> {
    if (signal.aborted) return;
    const handle = await this.server();
    const streamAbort = new AbortController();
    let finished = false;
    const aborted = new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // Stop interrupts the turn. The server stays up and still writes the turn's terminal event.
    void aborted.then(() => {
      if (!finished && this.sessionId) void this.stopTurn(handle.url, this.sessionId);
    });
    try {
      const started = this.sessionId
        ? await this.followUp(handle.url, prompt)
        : await this.create(handle.url, prompt);
      if (!started.ok) {
        if (!signal.aborted) yield { type: "error", message: started.message };
        return;
      }
      if (started.modelFallback) {
        yield {
          type: "error",
          message:
            "The session API did not accept a model override. This session runs the model from hosts/cursor/bot/agent.ts.",
        };
      }
      if (signal.aborted && this.sessionId) await this.stopTurn(handle.url, this.sessionId);
      const id = this.sessionId;
      if (!id) {
        yield { type: "error", message: "The session id was lost before the stream opened." };
        return;
      }
      const response = await fetch(
        `${handle.url}/v1/session/${encodeURIComponent(id)}/stream?startIndex=${this.nextIndex}`,
        { signal: streamAbort.signal },
      );
      if (!response.ok) {
        const body = await readJson(response);
        if (!signal.aborted) yield { type: "error", message: errorText(body, response.status) };
        return;
      }
      const messages = ndjson(response)[Symbol.asyncIterator]();
      for (;;) {
        const next = await nextTurnMessage(messages, aborted, signal);
        if (next === undefined || next.done) {
          if (!signal.aborted && next?.done) {
            yield { type: "error", message: "The session stream ended before the turn finished." };
          }
          return;
        }
        const event = next.value;
        this.noteIndex(event);
        const mapped = mapCursorEvent(event);
        if (event.type === "turn.completed" || event.type === "turn.failed") {
          const cost = await this.readCost(handle.url, id);
          const usage = mapped.find((item) => item.type === "usage");
          if (cost !== undefined && usage?.type === "usage") usage.costUsd = cost;
          else if (cost !== undefined) mapped.unshift({ type: "usage", costUsd: cost, contextWindow: CURSOR_CONTEXT_WINDOW });
        }
        for (const item of mapped) {
          if (signal.aborted && item.type === "error") continue;
          yield item;
        }
        if (event.type === "turn.completed" || event.type === "turn.failed") {
          finished = true;
          return;
        }
      }
    } catch (error) {
      if (!signal.aborted && !finished) yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      finished = true;
      streamAbort.abort();
    }
  }

  async close(): Promise<void> {
    const starting = this.starting;
    this.starting = undefined;
    this.detachSession();
    if (!starting) return;
    const handle = await starting.catch(() => undefined);
    await handle?.close();
  }
}
