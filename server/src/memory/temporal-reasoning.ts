// Temporal-reasoning MCP server (spec 10 §10.4): one stdio child per memory space, owned by the
// backend. Its query/transact/retract/rule tools are proxied to every agent session; prepare/finalize
// run per turn from the host, as its Claude Code hooks do. Extraction uses MCP sampling ("agent"
// strategy), answered by `sample`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { HostTool, ToolOutcome } from "../inference/types.js";
import type { Logger } from "../log.js";
import { splitEntityTypes } from "./sampler.js";

/** PyPI package pinned for reproducible behaviour (`uvx temporal-reasoning==…`). */
export const TEMPORAL_REASONING_PACKAGE = "temporal-reasoning==0.9.0";
/** Server tools exposed to the voice agent; ingestion, audit and issue reporting are not. */
export const AGENT_TOOLS = ["minigraf_query", "minigraf_transact", "minigraf_retract", "minigraf_rule"] as const;

/** Finalize includes one sampling round trip (a model call). */
const FINALIZE_TIMEOUT_MS = 120_000;

/** Answers an MCP sampling request (fact extraction prompt) with model text. */
export type Sampler = (prompt: string, maxTokens: number) => Promise<string>;

export interface TemporalReasoningOptions {
  graphPath: string;
  /** Child command; default `uvx <TEMPORAL_REASONING_PACKAGE>`. */
  command?: string;
  args?: string[];
  cwd?: string;
  sample: Sampler;
  /** Per-call timeout. */
  callTimeoutMs?: number;
}

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface TextContent {
  type: string;
  text?: string;
}

export class TemporalReasoning {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  private toolInfo: ToolInfo[] = [];
  /** Finalize calls run one at a time, in turn order. */
  private finalizing: Promise<void> = Promise.resolve();
  private closed = false;
  /** Person / place tags from the current finalize's sampling (D-28). */
  private pendingTags: string[] = [];
  private readonly log: Logger;

  constructor(
    private readonly opts: TemporalReasoningOptions,
    log: Logger,
  ) {
    this.log = log.child({ component: "temporal-reasoning" });
  }

  /** Starts the child and reads its tool list. */
  async start(): Promise<void> {
    await this.connection();
  }

  private connection(): Promise<Client> {
    if (this.closed) return Promise.reject(new Error("temporal-reasoning closed"));
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const t0 = performance.now();
    // The nix shell's PYTHONPATH (piper-tts, ESP-IDF) would leak into the uvx environment.
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("PYTHON")),
    );
    const transport = new StdioClientTransport({
      command: this.opts.command ?? "uvx",
      args: this.opts.args ?? [TEMPORAL_REASONING_PACKAGE],
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
      env: {
        ...env,
        MINIGRAF_GRAPH_PATH: this.opts.graphPath,
        MINIGRAF_NO_AUTO_INGEST: "1",
        MINIGRAF_EXTRACTION_STRATEGY: "agent",
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (b: Buffer) => {
      for (const line of b.toString().split("\n")) if (line.trim()) this.log.debug("stderr", { line: line.slice(0, 500) });
    });
    const client = new Client({ name: "homunculus", version: "1" }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
      const prompt = req.params.messages
        .flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content]))
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n\n");
      const t0 = performance.now();
      // The server's extraction path replaces :entity-type with :type/constraint; person / place tags
      // (D-28) are transacted after finalize instead.
      const { block: text, tags } = splitEntityTypes(await this.opts.sample(prompt, req.params.maxTokens));
      this.pendingTags.push(...tags);
      this.log.info("sampled", { ms: Math.round(performance.now() - t0), chars: text.length });
      this.log.debug("sampled_text", { prompt: prompt.slice(-1500), text: text.slice(0, 1500) });
      return { role: "assistant", model: "homunculus-sampler", content: { type: "text", text } };
    });
    client.onclose = () => {
      if (this.client === client) this.client = undefined;
      if (!this.closed) this.log.warn("server_exited");
    };
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.toolInfo = tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    this.client = client;
    this.log.info("server_ready", { ms: Math.round(performance.now() - t0), graph: this.opts.graphPath, tools: tools.length });
    return client;
  }

  /** Calls a server tool; restarts the child if it exited. */
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number): Promise<ToolOutcome> {
    const client = await this.connection();
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: timeoutMs ?? this.opts.callTimeoutMs ?? 30_000,
      ...(signal ? { signal } : {}),
    });
    const text = ((r.content as TextContent[] | undefined) ?? [])
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n");
    // The server reports failures as {"ok": false, ...} inside a successful call.
    return { ok: !r.isError && !/^\s*\{\s*"ok"\s*:\s*false/.test(text), text };
  }

  /** Proxies of the agent-facing server tools (names and schemas as the server lists them). */
  tools(): HostTool[] {
    return this.toolInfo
      .filter((t) => (AGENT_TOOLS as readonly string[]).includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: t.inputSchema,
        policy: "allow" as const,
        call: async (args, signal) => {
          try {
            return await this.call(t.name, (args ?? {}) as Record<string, unknown>, signal);
          } catch (e) {
            return { ok: false, text: (e as Error).message };
          }
        },
      }));
  }

  /** Memory context for a user message (`memory_prepare_turn`); "" when nothing matches. */
  async prepare(userMessage: string): Promise<string> {
    const r = await this.call("memory_prepare_turn", { user_message: userMessage });
    return r.ok ? r.text.trim() : "";
  }

  /** Extracts and stores facts of a finished exchange (`memory_finalize_turn`), queued in order. */
  finalize(conversationDelta: string): Promise<void> {
    const run = async () => {
      try {
        this.pendingTags = [];
        const r = await this.call("memory_finalize_turn", { conversation_delta: conversationDelta }, undefined, FINALIZE_TIMEOUT_MS);
        this.log.info("finalize", { ok: r.ok, result: r.text.slice(0, 300) });
        const tags = this.pendingTags.splice(0);
        if (r.ok && tags.length) {
          const t = await this.call("minigraf_transact", { facts: `[${tags.join("\n ")}]`, reason: "Person / place type of extracted entities (D-28)" });
          this.log.info("entity_types", { ok: t.ok, tags: tags.length, ...(t.ok ? {} : { error: t.text.slice(0, 200) }) });
        }
      } catch (e) {
        this.log.warn("finalize_failed", { error: (e as Error).message });
      }
    };
    this.finalizing = this.finalizing.then(run);
    return this.finalizing;
  }

  async close(): Promise<void> {
    await this.finalizing;
    this.closed = true;
    const c = this.client;
    this.client = undefined;
    await c?.close();
  }
}
