import type * as acp from "@agentclientprotocol/sdk/unstable";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoRoot as defaultRepoRoot } from "../../core/elixir-bridge.ts";
import {
  AcpAgentConnection,
  denyPermission,
  type PermissionHandler,
} from "../../hosts/acp/connection.ts";
import type { DiscoveredAgent } from "../../hosts/acp/discovery.ts";
import {
  defaultStateRoot,
  loadMaxContextTokens,
  resolveHostFlags,
} from "../../hosts/cursor/bot/lib/host-flags.ts";
import { sessionHarnessDir } from "../../hosts/cursor/bot/lib/session-workspace.ts";
import { HANDOFF_REQUEST, recordFork, routeTurn, seedMessage } from "./handoff.ts";
import type { HostAdapter, HostEvent, ModelChoice, SessionSummary } from "./types.ts";

export const ACP_ADAPTER_PREFIX = "acp:";

function blockText(block: acp.ContentBlock | undefined): string {
  return block?.type === "text" ? block.text : "";
}

function toolOutput(update: { content?: acp.ToolCallContent[] | null; rawOutput?: unknown }): string {
  const parts = (update.content ?? []).map((item) => {
    if (item.type === "content") return blockText(item.content);
    if (item.type === "diff") return `${item.path}\n${item.newText}`;
    return "";
  });
  const text = parts.filter(Boolean).join("\n");
  if (text || update.rawOutput === undefined) return text;
  return typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput);
}

/** Maps `session/update` notifications to TUI events. A tool call reports its result once. */
export class AcpEventMapper {
  private readonly seen = new Set<string>();
  private readonly finished = new Set<string>();

  map(update: acp.SessionUpdate): HostEvent[] {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return [{ type: "text", delta: blockText(update.content) }];
      case "agent_thought_chunk":
        return [{ type: "reasoning", delta: blockText(update.content) }];
      case "user_message_chunk":
        return [{ type: "user", text: blockText(update.content) }];
      case "tool_call":
      case "tool_call_update":
        return this.tool(update);
      case "usage_update":
        return [
          {
            type: "usage",
            contextTokens: update.used,
            contextWindow: update.size,
            // HostEvent cost is in USD. Another currency cannot be added to the total.
            ...(update.cost?.currency === "USD" ? { costUsd: update.cost.amount } : {}),
          },
        ];
      case "notice":
        return update.severity === "error"
          ? [{ type: "error", message: [update.title, update.description].filter(Boolean).join(": ") }]
          : [];
      default:
        return [];
    }
  }

  private tool(
    update: Extract<acp.SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
  ): HostEvent[] {
    const id = update.toolCallId;
    const events: HostEvent[] = [];
    if (!this.seen.has(id)) {
      this.seen.add(id);
      events.push({
        type: "tool",
        id,
        name: update.name ?? update.title ?? "tool",
        input: update.rawInput,
      });
    }
    const terminal = update.status === "completed" || update.status === "failed";
    if (terminal && !this.finished.has(id)) {
      this.finished.add(id);
      events.push({
        type: "tool_result",
        id,
        ok: update.status === "completed",
        output: toolOutput(update),
      });
    }
    return events;
  }
}

/** Joins the chunks of a replayed user message, which a live turn never produces. */
export function mergeReplayedUserChunks(events: HostEvent[]): HostEvent[] {
  const merged: HostEvent[] = [];
  for (const event of events) {
    const last = merged.at(-1);
    if (event.type === "user" && last?.type === "user") last.text += event.text;
    else merged.push(event.type === "user" ? { ...event } : event);
  }
  return merged;
}

type IndexedSession = { id: string; title: string; updatedAt: string; cwd: string };

/** Sessions the TUI started on one agent, newest last. */
export class AcpSessionIndex {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  all(): IndexedSession[] {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as IndexedSession[];
    } catch {
      return [];
    }
  }

  get(id: string): IndexedSession | undefined {
    return this.all().find((s) => s.id === id);
  }

  /** Records a turn. The first prompt becomes the title. */
  touch(id: string, cwd: string, prompt: string, now = new Date()): void {
    const rest = this.all();
    const current = rest.find((s) => s.id === id);
    const entry: IndexedSession = {
      id,
      cwd,
      title: current?.title ?? prompt,
      updatedAt: now.toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      `${JSON.stringify([...rest.filter((s) => s.id !== id), entry], null, 2)}\n`,
    );
  }
}

function flatOptions(option: acp.SessionConfigOption): { value: string; name: string }[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((item) => ("options" in item ? item.options : [item]));
}

function isHandoffSuccess(event: HostEvent): boolean {
  return event.type === "tool_result" && event.ok && event.output.includes("Wrote handoff.md");
}

export type AcpAdapterOptions = {
  repoRoot?: string;
  stateRoot?: string;
  requestPermission?: PermissionHandler;
};

/** Runs an external ACP agent as a TUI host. Alchemist is the ACP client. */
export class AcpClientAdapter implements HostAdapter {
  readonly name: string;
  sessionId: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  notice: string | undefined;
  private readonly agent: DiscoveredAgent;
  private readonly repoRoot: string;
  private readonly stateRoot: string;
  private readonly requestPermission: PermissionHandler;
  private readonly index: AcpSessionIndex;
  private connecting: Promise<AcpAgentConnection> | undefined;
  private cwd: string | undefined;
  /** The connection that knows `sessionId`. A restarted agent has to load it again. */
  private sessionOwner: AcpAgentConnection | undefined;
  private configOptions: acp.SessionConfigOption[] = [];
  /** Model and effort changes that are still being applied to the session. */
  private settings: Promise<unknown> = Promise.resolve();
  private lastContextTokens = 0;
  private pendingHandoff = false;

  constructor(agent: DiscoveredAgent, options: AcpAdapterOptions = {}) {
    this.agent = agent;
    this.name = `${ACP_ADAPTER_PREFIX}${agent.id}`;
    this.repoRoot = options.repoRoot ?? defaultRepoRoot;
    this.stateRoot = options.stateRoot ?? defaultStateRoot("acp");
    this.requestPermission = options.requestPermission ?? denyPermission;
    this.index = new AcpSessionIndex(path.join(this.stateRoot, "agents", agent.id, "sessions.json"));
  }

  /** Opens the connection, or returns the live one. A dead connection is replaced. */
  private connect(): Promise<AcpAgentConnection> {
    if (this.connecting) return this.connecting;
    const connecting = AcpAgentConnection.open({
      agent: this.agent,
      repoRoot: this.repoRoot,
      requestPermission: this.requestPermission,
      sessionId: () => this.sessionId,
    }).then((connection) => {
      this.notice = connection.mcpOverAcp
        ? undefined
        : `${this.agent.label} does not support MCP-over-ACP. Chat works, but the codex tools are unavailable.`;
      void connection.closed.then(() => {
        if (this.connecting === connecting) this.connecting = undefined;
      });
      return connection;
    });
    this.connecting = connecting;
    connecting.catch(() => {
      if (this.connecting === connecting) this.connecting = undefined;
    });
    return connecting;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.index
      .all()
      .map((s) => ({ id: s.id, title: s.title, updatedAt: new Date(s.updatedAt) }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  private applyConfigOptions(options: acp.SessionConfigOption[] | null | undefined): void {
    this.configOptions = options ?? [];
    const current = (category: string) => {
      const option = this.configOptions.find((o) => o.category === category);
      return option?.type === "select" ? option.currentValue : undefined;
    };
    this.model = current("model");
    this.effort = current("thought_level");
  }

  private async startSession(): Promise<void> {
    const connection = await this.connect();
    // The agent assigns the session id, so the harness has its own id.
    const cwd = sessionHarnessDir(this.stateRoot, randomUUID());
    fs.mkdirSync(cwd, { recursive: true });
    const session = await connection.newSession(cwd);
    this.sessionId = session.sessionId;
    this.sessionOwner = connection;
    this.cwd = cwd;
    this.applyConfigOptions(session.configOptions);
  }

  async openSession(id: string | undefined): Promise<HostEvent[]> {
    this.pendingHandoff = false;
    this.lastContextTokens = 0;
    if (!id) {
      this.sessionId = undefined;
      await this.startSession();
      return [];
    }
    const connection = await this.connect();
    const entry = this.index.get(id);
    if (!entry) throw new Error(`Unknown ACP session ${id}.`);
    if (!connection.canLoadSessions) {
      throw new Error(`${this.agent.label} cannot load sessions. Start a new session instead.`);
    }
    const mapper = new AcpEventMapper();
    const events: HostEvent[] = [];
    const loaded = await connection.loadSession(id, entry.cwd, (update) => {
      events.push(...mapper.map(update));
    });
    this.sessionId = id;
    this.sessionOwner = connection;
    this.cwd = entry.cwd;
    this.applyConfigOptions(loaded.configOptions);
    return mergeReplayedUserChunks(events);
  }

  async listModels(): Promise<ModelChoice[]> {
    if (!this.sessionId) await this.startSession();
    const model = this.configOptions.find((o) => o.category === "model");
    const thought = this.configOptions.find((o) => o.category === "thought_level");
    const efforts = thought ? flatOptions(thought).map((o) => o.value) : [];
    return model
      ? flatOptions(model).map((o) => ({ id: o.value, label: o.name, efforts }))
      : [];
  }

  setModel(model: string | undefined, effort: string | undefined): void {
    const changes: [string, string | undefined][] = [
      ["model", model !== this.model ? model : undefined],
      ["thought_level", effort !== this.effort ? effort : undefined],
    ];
    this.model = model;
    this.effort = effort;
    const sessionId = this.sessionId;
    if (!sessionId || !this.connecting) return;
    const connecting = this.connecting;
    for (const [category, value] of changes) {
      const option = this.configOptions.find((o) => o.category === category);
      if (!option || value === undefined) continue;
      this.settings = this.settings
        .then(async () => (await connecting).setConfigOption(sessionId, option.id, value))
        .catch((error: unknown) => console.error(`[acp] cannot set ${category}: ${String(error)}`));
    }
  }

  async *send(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent> {
    // Without the MCP server the agent has no handoff tool, so a fork could never finish.
    const connection = await this.connect();
    if (!connection.mcpOverAcp || !resolveHostFlags(this.stateRoot, "acp").handoffFork) {
      yield* this.runTurn(prompt, signal);
      return;
    }
    const oldId = this.sessionId;
    const route = routeTurn({
      hasSession: Boolean(this.sessionId),
      lastContextTokens: this.lastContextTokens,
      pendingHandoff: this.pendingHandoff,
      handoffFilePresent: fs.existsSync(this.handoffPath()),
      userText: prompt,
      forkAboveTokens: loadMaxContextTokens(this.stateRoot, "acp"),
    });
    switch (route.kind) {
      case "error":
        yield { type: "error", message: route.message };
        return;
      case "compact-then-fork":
        yield* this.runTurn(HANDOFF_REQUEST, signal);
        if (signal.aborted) return;
        if (!this.pendingHandoff) {
          yield { type: "error", message: "Handoff did not complete. Try again or use /new." };
          return;
        }
        yield* this.fork(oldId, route.userText, signal);
        return;
      case "fork":
        yield* this.fork(oldId, route.userText, signal);
        return;
      default:
        yield* this.runTurn(route.message, signal);
    }
  }

  private handoffPath(): string {
    return path.join(this.repoRoot, "handoff.md");
  }

  private async *fork(
    oldId: string | undefined,
    userText: string,
    signal: AbortSignal,
  ): AsyncIterable<HostEvent> {
    if (!fs.existsSync(this.handoffPath())) {
      yield { type: "error", message: "Handoff file is missing. Write handoff.md before continuing." };
      return;
    }
    const file = fs.readFileSync(this.handoffPath(), "utf8");
    this.sessionId = undefined;
    this.pendingHandoff = false;
    this.lastContextTokens = 0;
    yield* this.runTurn(seedMessage(file, userText), signal);
    if (oldId && this.sessionId) recordFork(this.stateRoot, oldId, this.sessionId);
  }

  /** Restores the session on a restarted agent. Returns false when it starts a new one instead. */
  private async recoverSession(connection: AcpAgentConnection): Promise<boolean> {
    const id = this.sessionId as string;
    const cwd = this.index.get(id)?.cwd;
    if (connection.canLoadSessions && cwd) {
      try {
        await connection.loadSession(id, cwd, () => undefined);
        this.sessionOwner = connection;
        return true;
      } catch (error) {
        console.error(`[acp] cannot reload session ${id}: ${String(error)}`);
      }
    }
    this.sessionId = undefined;
    await this.startSession();
    return false;
  }

  private async *runTurn(prompt: string, signal: AbortSignal): AsyncIterable<HostEvent> {
    try {
      await this.settings;
      const connection = await this.connect();
      if (!this.sessionId) await this.startSession();
      else if (this.sessionOwner !== connection && !(await this.recoverSession(connection))) {
        yield {
          type: "error",
          message: "The agent restarted and could not reload the session. This prompt starts a new one.",
        };
      }
      const sessionId = this.sessionId as string;
      this.index.touch(sessionId, this.cwd as string, prompt);
      const mapper = new AcpEventMapper();
      for await (const message of connection.prompt(sessionId, prompt, signal)) {
        if (message.kind === "update") {
          for (const event of mapper.map(message.update)) {
            if (event.type === "usage" && event.contextTokens !== undefined) {
              this.lastContextTokens = event.contextTokens;
            }
            if (isHandoffSuccess(event)) this.pendingHandoff = true;
            yield event;
          }
        } else if (message.stopReason === "end_turn") {
          yield { type: "done", sessionId };
        } else if (message.stopReason !== "cancelled") {
          yield { type: "error", message: `The agent stopped the turn: ${message.stopReason}.` };
        }
      }
    } catch (error) {
      // A stopped turn may end by dropping the connection. The TUI already reports the stop.
      if (!signal.aborted) {
        yield { type: "error", message: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  async close(): Promise<void> {
    const connecting = this.connecting;
    this.connecting = undefined;
    if (connecting) await (await connecting).close();
  }
}
