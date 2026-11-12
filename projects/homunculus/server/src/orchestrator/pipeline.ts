// Assembles the speech pipeline (spec §5.1): providers, persona, agent backend; one Conversation per device.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { DeviceConnection } from "../gateway/connection.js";
import { ClaudeAgentBackend } from "../inference/claude/backend.js";
import type { AgentBackend } from "../inference/types.js";
import type { Logger } from "../log.js";
import { Memory } from "../memory/memory.js";
import { memoryPrompt } from "../memory/prompt.js";
import { claudeSampler } from "../memory/sampler.js";
import { MEMORY_SERVER, WIKI_SERVER, wikiTools } from "../memory/tools.js";
import { buildSystemPrompt, loadPersona, type Persona } from "../persona/persona.js";
import { conversationTimeouts, createStt, createTts, createVad, endpointerOptions, shaperOptions } from "../speech/config.js";
import type { SttProvider, TtsProvider, VadModel } from "../speech/types.js";
import { DeviceBridge } from "../tools/device-bridge.js";
import { Conversation, type ConversationTimeouts } from "./conversation.js";

export interface PipelineDeps {
  persona: Persona;
  stt: SttProvider;
  tts: TtsProvider;
  vad: VadModel;
  backend: AgentBackend;
  /** Per-device sandbox directories are created below this directory. */
  sandboxRoot: string;
  timeouts?: Partial<ConversationTimeouts>;
  /** Long-term memory (spec 10); absent = disabled. */
  memory?: PipelineMemory;
  log: Logger;
}

export interface PipelineMemory {
  mem: Memory;
  timeZone?: string;
}

interface Entry {
  conn: DeviceConnection;
  conv: Conversation;
  bridge: DeviceBridge;
  hdpSession: string;
}

export interface Pipeline {
  attach(conn: DeviceConnection): void;
  close(): Promise<void>;
}

/**
 * Filesystem-safe directory name for a device id: characters outside [A-Za-z0-9_-] become "_"
 * (no ".", "/", ".."), max 48 chars, plus a hash suffix so distinct ids never collide.
 */
export function deviceDirName(deviceId: string): string {
  const safe = deviceId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "device";
  const hash = createHash("sha256").update(deviceId).digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}

export function createPipeline(d: PipelineDeps): Pipeline {
  const systemPrompt = buildSystemPrompt(d.persona);
  const log = d.log.child({ component: "pipeline" });
  /** HDP session id → backend session id, for resume after reconnect (in memory until §5.7). */
  const agentSessions = new Map<string, string>();
  /** Live conversation per device id: a reconnecting device replaces its old connection. */
  const devices = new Map<string, Entry>();
  /** Closes the conversation (idempotent) and records its backend session id for resume. */
  const endConversation = (e: Entry) =>
    e.conv.close().then((id) => {
      e.bridge.close();
      if (id) agentSessions.set(e.hdpSession, id);
    });

  return {
    attach(conn) {
      conn.on("ready", () => {
        const deviceId = conn.identity.deviceId;
        const hdpSession = conn.sessionId ?? "";
        const prev = devices.get(deviceId);
        let prevClosed: Promise<void> = Promise.resolve();
        if (prev) {
          // Same device reconnected before the old socket timed out: one agent session per device.
          log.warn("device_replaced", { device: deviceId });
          prevClosed = endConversation(prev);
          prev.conn.close(4000, "replaced");
        }
        const cwd = join(d.sandboxRoot, deviceDirName(deviceId));
        const bridge = new DeviceBridge(conn, () => conn.hello?.tools);
        const m = d.memory;
        const servers = m
          ? { [MEMORY_SERVER]: m.mem.temporal.tools(), [WIKI_SERVER]: wikiTools(m.mem) }
          : undefined;
        // Memory section at every agent session open (spec 10 §10.5); a memory failure must not block the session.
        const prompt = () => {
          if (!m) return systemPrompt;
          try {
            return `${systemPrompt}\n\n${memoryPrompt(m.mem, new Date(), m.timeZone)}`;
          } catch (e) {
            log.warn("memory_prompt_failed", { error: (e as Error).message });
            return systemPrompt;
          }
        };
        const conv = new Conversation(conn, {
          bridge,
          stt: d.stt,
          tts: d.tts,
          vad: d.vad,
          voice: d.persona.tts.voice,
          language: d.persona.language,
          // The replaced conversation's agent session is closed before its id is resumed here.
          resumeSessionId: prevClosed.then(() => agentSessions.get(hdpSession)),
          openAgent: async (resumeSessionId) =>
            d.backend.openSession({
              systemPrompt: prompt(),
              resumeSessionId,
              cwd,
              tools: bridge.tools(),
              ...(servers ? { servers } : {}),
              confirm: (req, signal) => bridge.confirm(req, signal),
            }),
          ...(m
            ? {
                // Per-turn memory, as temporal-reasoning's Claude Code hooks (spec 10 §10.5).
                turnContext: (text: string) => m.mem.temporal.prepare(text),
                onTurn: (t) => {
                  if (t.error || !t.reply) return;
                  const reply = t.heard !== undefined ? `${t.heard} (interrupted)` : t.reply;
                  void m.mem.temporal.finalize(`User: ${t.text}\nAssistant: ${reply}`);
                },
              }
            : {}),
          quietTool: (name) => name.startsWith(`mcp__${MEMORY_SERVER}__`) || name.startsWith(`mcp__${WIKI_SERVER}__`),
          endpointer: endpointerOptions(),
          shaper: shaperOptions(),
          timeouts: d.timeouts,
        });
        const entry: Entry = { conn, conv, bridge, hdpSession };
        devices.set(deviceId, entry);
        conn.on("close", () => {
          if (devices.get(deviceId) === entry) devices.delete(deviceId);
          void endConversation(entry);
        });
      });
    },
    async close() {
      await Promise.all([...devices.values()].map((e) => e.conv.close()));
      await d.memory?.mem.close();
      await Promise.all([d.stt.close?.(), d.tts.close?.()]);
    },
  };
}

/** Production wiring from environment (docs/development.md). */
export async function createSpeechPipeline(log: Logger): Promise<Pipeline> {
  const env = process.env;
  const persona = await loadPersona(env.HOMUNCULUS_PERSONA ?? "claudia");
  const voice = env.HOMUNCULUS_TTS_VOICE ?? persona.tts.voice;
  const stt = createStt(log, persona.language);
  const tts = createTts(persona.tts.provider, log);
  const model = env.HOMUNCULUS_MODEL ?? "claude-opus-5-5";
  const effort = (env.HOMUNCULUS_EFFORT ?? "low") as EffortLevel;
  const sandboxRoot = fileURLToPath(new URL("../../.data/sandbox/devices", import.meta.url));
  const backend = new ClaudeAgentBackend({
    model,
    effort,
    tools: ["WebSearch", "WebFetch"],
    cwd: sandboxRoot,
  });
  const memory = await openMemory(log);
  const t0 = performance.now();
  const [vad] = await Promise.all([createVad(), stt.warmup?.(), tts.warmup?.(voice)]);
  log.info("pipeline_ready", {
    ms: Math.round(performance.now() - t0),
    persona: persona.id,
    stt: stt.id,
    tts: tts.id,
    voice,
    model,
    effort,
  });
  return createPipeline({
    persona: { ...persona, tts: { ...persona.tts, voice } },
    stt,
    tts,
    vad,
    backend,
    sandboxRoot,
    timeouts: conversationTimeouts(),
    ...(memory ? { memory } : {}),
    log,
  });
}

/** Long-term memory from environment (spec 10 §10.2); HOMUNCULUS_MEMORY=0 disables it. */
async function openMemory(log: Logger): Promise<PipelineMemory | undefined> {
  const env = process.env;
  if (env.HOMUNCULUS_MEMORY === "0") return undefined;
  const root = env.HOMUNCULUS_MEMORY_DIR ?? fileURLToPath(new URL("../../.data/memory", import.meta.url));
  const space = env.HOMUNCULUS_MEMORY_SPACE ?? "default";
  const timeZone = env.HOMUNCULUS_TIMEZONE || undefined;
  const model = env.HOMUNCULUS_MEMORY_MODEL ?? "claude-sonnet-5-5";
  const command = env.HOMUNCULUS_MEMORY_MCP?.split(/\s+/).filter(Boolean);
  const mem = await Memory.open(root, space, log, {
    watch: true,
    temporal: {
      sample: claudeSampler(model, timeZone),
      ...(command?.length ? { command: command[0]!, args: command.slice(1) } : {}),
    },
  });
  log.info("memory_ready", { root, space, extraction_model: model });
  return { mem, ...(timeZone ? { timeZone } : {}) };
}
