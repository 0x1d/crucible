// Assembles the speech pipeline (spec §5.1): providers, persona, agent backend; one Conversation per device.
import { fileURLToPath } from "node:url";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { DeviceConnection } from "../gateway/connection.js";
import { ClaudeAgentBackend } from "../inference/claude/backend.js";
import type { AgentBackend, AgentSession } from "../inference/types.js";
import type { Logger } from "../log.js";
import { buildSystemPrompt, loadPersona, type Persona } from "../persona/persona.js";
import { createStt, createTts, createVad, endpointerOptions } from "../speech/config.js";
import type { SttProvider, TtsProvider, VadModel } from "../speech/types.js";
import { Conversation } from "./conversation.js";

export interface PipelineDeps {
  persona: Persona;
  stt: SttProvider;
  tts: TtsProvider;
  vad: VadModel;
  backend: AgentBackend;
  log: Logger;
}

export interface Pipeline {
  attach(conn: DeviceConnection): void;
  close(): Promise<void>;
}

export function createPipeline(d: PipelineDeps): Pipeline {
  const systemPrompt = buildSystemPrompt(d.persona);
  /** HDP session id → backend session id, for resume after reconnect (in memory until §5.7). */
  const agentSessions = new Map<string, string>();
  const live = new Set<AgentSession>();

  return {
    attach(conn) {
      conn.on("ready", () => {
        const hdpSession = conn.sessionId ?? "";
        const agent = d.backend.openSession({ systemPrompt, resumeSessionId: agentSessions.get(hdpSession) });
        new Conversation(conn, {
          stt: d.stt,
          tts: d.tts,
          vad: d.vad,
          voice: d.persona.tts.voice,
          language: d.persona.language,
          agent,
          endpointer: endpointerOptions(),
        });
        void agent.then((s) => live.add(s)).catch(() => {});
        conn.on("close", () => {
          void agent
            .then(async (s) => {
              if (s.sessionId) agentSessions.set(hdpSession, s.sessionId);
              live.delete(s);
              await s.close();
            })
            .catch(() => {});
        });
      });
    },
    async close() {
      await Promise.all([...live].map((s) => s.close()));
      await Promise.all([d.stt.close?.(), d.tts.close?.()]);
    },
  };
}

/** Production wiring from environment (docs/development.md). */
export async function createSpeechPipeline(log: Logger): Promise<Pipeline> {
  const env = process.env;
  const persona = await loadPersona(env.HOMUNCULUS_PERSONA ?? "claudia");
  const voice = env.HOMUNCULUS_TTS_VOICE ?? persona.tts.voice;
  const stt = createStt(log);
  const tts = createTts(persona.tts.provider, log);
  const model = env.HOMUNCULUS_MODEL ?? "claude-opus-5-5";
  const effort = (env.HOMUNCULUS_EFFORT ?? "low") as EffortLevel;
  const backend = new ClaudeAgentBackend({
    model,
    effort,
    tools: ["WebSearch", "WebFetch"],
    cwd: fileURLToPath(new URL("../../.data/sandbox/devices", import.meta.url)),
  });
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
  return createPipeline({ persona: { ...persona, tts: { ...persona.tts, voice } }, stt, tts, vad, backend, log });
}
