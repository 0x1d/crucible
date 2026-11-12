import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { resolveSpawnSpec, type DiscoveredAgent } from "./discovery.ts";
import { alchemistMcpTools } from "./alchemist-mcp.ts";
import { AcpHarnessFs } from "./harness.ts";
import { mcpOverAcpSupported } from "./probe.ts";
import { killAcpAgent, spawnAcpAgent, type SpawnedAgent } from "./spawn.ts";

/** How long a cancelled prompt may take to answer before the connection is dropped. */
export const CANCEL_GRACE_MS = 10_000;

export type PermissionHandler = (
  request: acp.RequestPermissionRequest,
  signal: AbortSignal,
) => Promise<acp.RequestPermissionOutcome>;

export type PromptMessage =
  | { kind: "update"; update: acp.SessionUpdate }
  | { kind: "stop"; stopReason: acp.StopReason };

export type AcpConnectionOptions = {
  agent: DiscoveredAgent;
  repoRoot: string;
  requestPermission: PermissionHandler;
  /** Session id for `source_session` stamps on `memory.remember`. */
  sessionId: () => string | undefined;
};

/** Headless default: refuses when the agent offers a refusal, otherwise cancels. */
export const denyPermission: PermissionHandler = async ({ options }) => {
  const option = options.find((o) => o.kind === "reject_once") ?? options.find((o) => o.kind === "reject_always");
  return option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" };
};

type TurnItem = PromptMessage | { kind: "failed"; error: unknown };

/** One agent process with one ACP connection, which can serve many sessions. */
export class AcpAgentConnection {
  readonly protocolVersion: number;
  readonly capabilities: acp.AgentCapabilities;
  readonly agentName: string | undefined;
  private readonly spawned: SpawnedAgent;
  private readonly connection: acp.ClientConnection;
  private readonly listeners: Map<string, (update: acp.SessionUpdate) => void>;
  private readonly cwds: Set<string>;
  private readonly mcpServers: acp.McpServer[];
  private readonly closeMcp: () => Promise<void>;
  private readonly turn: { signal?: AbortSignal };

  private constructor(fields: {
    init: acp.InitializeResponse;
    spawned: SpawnedAgent;
    connection: acp.ClientConnection;
    listeners: Map<string, (update: acp.SessionUpdate) => void>;
    cwds: Set<string>;
    mcpServers: acp.McpServer[];
    closeMcp: () => Promise<void>;
    turn: { signal?: AbortSignal };
  }) {
    this.protocolVersion = fields.init.protocolVersion;
    this.capabilities = fields.init.agentCapabilities ?? {};
    this.agentName = fields.init.agentInfo?.name;
    this.spawned = fields.spawned;
    this.connection = fields.connection;
    this.listeners = fields.listeners;
    this.cwds = fields.cwds;
    this.mcpServers = fields.mcpServers;
    this.closeMcp = fields.closeMcp;
    this.turn = fields.turn;
  }

  static async open(options: AcpConnectionOptions): Promise<AcpAgentConnection> {
    const spawned = spawnAcpAgent(
      resolveSpawnSpec(options.agent.spawn, options.repoRoot, options.repoRoot),
    );
    const listeners = new Map<string, (update: acp.SessionUpdate) => void>();
    const cwds = new Set<string>();
    const turn: { signal?: AbortSignal } = {};
    const harness = new AcpHarnessFs(() => [options.repoRoot, ...cwds]);
    const mcp = new acp.McpOverAcpProvider();

    const app = acp
      .client({ name: "alchemist" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        listeners.get(params.sessionId)?.(params.update);
      })
      // ACP requires a pending request to answer `cancelled` once its turn is cancelled.
      .onRequest(acp.methods.client.session.requestPermission, async ({ params, signal }) => {
        const stopped = turn.signal ? AbortSignal.any([signal, turn.signal]) : signal;
        if (stopped.aborted) return { outcome: { outcome: "cancelled" as const } };
        return { outcome: await options.requestPermission(params, stopped) };
      })
      .onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => ({
        content: await harness.read(params.path, params.line, params.limit),
      }))
      .onRequest(acp.methods.client.fs.writeTextFile, async ({ params }) => {
        await harness.write(params.path, params.content);
        return {};
      })
      .onRequest(acp.methods.client.mcp.message, mcp.handleRequest);

    const connection = app.connect(
      acp.ndJsonStream(
        Writable.toWeb(spawned.child.stdin),
        Readable.toWeb(spawned.child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    void spawned.ended.then((reason) => connection.close(reason));

    try {
      const init = await Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          clientInfo: { name: "alchemist", version: "1.0.0" },
        }),
        spawned.ended.then((reason) => Promise.reject(reason)),
      ]);
      // The server must exist before session/new, because an agent may call tools right away.
      const mcpServers: acp.McpServer[] = [];
      let closeMcp = async () => {};
      if (mcpOverAcpSupported(init.agentCapabilities)) {
        const tools = alchemistMcpTools({ hostId: "acp", sessionId: options.sessionId });
        const registration = mcp.registerServer(connection.agent, {
          name: "alchemist",
          handler: tools.handler,
        });
        mcpServers.push(registration.declaration);
        closeMcp = async () => {
          await registration.dispose();
          await tools.close();
        };
      }
      return new AcpAgentConnection({ init, spawned, connection, listeners, cwds, mcpServers, closeMcp, turn });
    } catch (error) {
      connection.close(error);
      killAcpAgent(spawned.child);
      throw error;
    }
  }

  /** Resolves when the connection ends, for any reason. */
  get closed(): Promise<void> {
    return this.connection.closed;
  }

  get mcpOverAcp(): boolean {
    return this.mcpServers.length > 0;
  }

  get canLoadSessions(): boolean {
    return this.capabilities.loadSession === true;
  }

  async newSession(cwd: string): Promise<acp.NewSessionResponse> {
    this.cwds.add(cwd);
    return this.connection.agent.request(acp.methods.agent.session.new, {
      cwd,
      mcpServers: this.mcpServers,
    });
  }

  /** Loads a session. The agent replays its history as updates before this resolves. */
  async loadSession(
    sessionId: string,
    cwd: string,
    onUpdate: (update: acp.SessionUpdate) => void,
  ): Promise<acp.LoadSessionResponse> {
    this.cwds.add(cwd);
    this.listeners.set(sessionId, onUpdate);
    try {
      return await this.connection.agent.request(acp.methods.agent.session.load, {
        sessionId,
        cwd,
        mcpServers: this.mcpServers,
      });
    } finally {
      this.listeners.delete(sessionId);
    }
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<acp.SetSessionConfigOptionResponse> {
    return this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId,
      configId,
      value,
    });
  }

  /**
   * Runs one prompt turn. Aborting `signal` sends `session/cancel`, and the turn still
   * ends with the agent's `cancelled` stop. An agent that does not answer in time loses
   * its connection, which ends the turn with an error.
   */
  async *prompt(
    sessionId: string,
    text: string,
    signal: AbortSignal,
    graceMs = CANCEL_GRACE_MS,
  ): AsyncGenerator<PromptMessage> {
    const items: TurnItem[] = [];
    let wake: (() => void) | undefined;
    const push = (item: TurnItem) => {
      items.push(item);
      wake?.();
    };
    let graceTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      this.connection.agent
        .notify(acp.methods.agent.session.cancel, { sessionId })
        .catch(() => undefined);
      graceTimer = setTimeout(
        () => this.close(new Error("The agent did not stop in time.")).catch(() => undefined),
        graceMs,
      );
    };

    this.listeners.set(sessionId, (update) => push({ kind: "update", update }));
    this.turn.signal = signal;
    try {
      this.connection.agent
        .request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text }],
        })
        .then(
          (response) => push({ kind: "stop", stopReason: response.stopReason }),
          (error: unknown) => push({ kind: "failed", error }),
        );
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });

      for (;;) {
        const item = items.shift();
        if (!item) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
          continue;
        }
        if (item.kind === "failed") throw item.error;
        yield item;
        if (item.kind === "stop") return;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(graceTimer);
      this.turn.signal = undefined;
      this.listeners.delete(sessionId);
    }
  }

  async close(reason?: unknown): Promise<void> {
    await this.closeMcp().catch(() => undefined);
    this.connection.close(reason);
    killAcpAgent(this.spawned.child);
  }
}
