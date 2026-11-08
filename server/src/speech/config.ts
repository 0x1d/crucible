// Speech pipeline configuration (spec §5.4): provider selection via environment.
import type { Logger } from "../log.js";
import { modelDir } from "./paths.js";
import { WhisperCppProvider } from "./stt/whisper-cpp.js";
import { KokoroTtsProvider } from "./tts/kokoro.js";
import { LoudnessTtsProvider } from "./tts/loudness.js";
import { PiperTtsProvider } from "./tts/piper.js";
import type { SttProvider, TtsProvider, VadModel } from "./types.js";
import type { ShaperOptions } from "./shaper.js";
import type { EndpointerOptions } from "./vad/endpointer.js";
import { SileroVad } from "./vad/silero.js";

const env = process.env;

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

/** STT provider; `language` (persona) is whisper's default `-l`. */
export function createStt(log: Logger, language = "en"): SttProvider {
  const provider = env.HOMUNCULUS_STT ?? "whisper-cpp";
  if (provider !== "whisper-cpp") throw new Error(`unknown STT provider ${provider}`);
  const model = env.HOMUNCULUS_WHISPER_MODEL ?? "base.en";
  return new WhisperCppProvider({
    modelPath: model.includes("/") ? model : `${modelDir}/whisper/ggml-${model}.bin`,
    url: env.HOMUNCULUS_WHISPER_URL,
    bin: env.HOMUNCULUS_WHISPER_BIN,
    threads: num(env.HOMUNCULUS_WHISPER_THREADS, 4),
    partialIntervalMs: num(env.HOMUNCULUS_STT_PARTIAL_MS, 1000),
    language,
    log,
  });
}

/** TTS provider: HOMUNCULUS_TTS overrides the persona's provider; output gain HOMUNCULUS_TTS_GAIN_DB. */
export function createTts(personaProvider: string, log: Logger): TtsProvider {
  const gainDb = num(env.HOMUNCULUS_TTS_GAIN_DB, 0);
  const tts = createTtsProvider(env.HOMUNCULUS_TTS ?? personaProvider, log);
  return gainDb === 0 ? tts : new LoudnessTtsProvider(tts, gainDb);
}

function createTtsProvider(provider: string, log: Logger): TtsProvider {
  switch (provider) {
    case "kokoro":
      return new KokoroTtsProvider({ dtype: (env.HOMUNCULUS_KOKORO_DTYPE as "fp32" | "q8") ?? "fp32" });
    case "piper":
      return new PiperTtsProvider({ modelDir: `${modelDir}/piper`, bin: env.HOMUNCULUS_PIPER_BIN, log });
    default:
      throw new Error(`unknown TTS provider ${provider}`);
  }
}

export function createVad(): Promise<VadModel> {
  return SileroVad.load(`${modelDir}/silero/silero_vad.onnx`);
}

/** First-segment length (spec §5.4.2 rule 3); undefined values keep the shaper defaults. */
export function shaperOptions(): Partial<ShaperOptions> {
  const o: Partial<ShaperOptions> = {};
  if (env.HOMUNCULUS_FIRST_MIN_WORDS) o.firstMinWords = Number(env.HOMUNCULUS_FIRST_MIN_WORDS);
  if (env.HOMUNCULUS_FIRST_MAX_WORDS) o.firstMaxWords = Number(env.HOMUNCULUS_FIRST_MAX_WORDS);
  return o;
}

/** Orchestrator timeouts (ms), see ConversationTimeouts. */
export function conversationTimeouts(): Record<string, number> {
  const pick: Record<string, string | undefined> = {
    uplinkGapMs: env.HOMUNCULUS_UPLINK_GAP_MS,
    sttFinalMs: env.HOMUNCULUS_STT_TIMEOUT_MS,
    agentIdleMs: env.HOMUNCULUS_AGENT_IDLE_TIMEOUT_MS,
    speechIdleMs: env.HOMUNCULUS_SPEECH_IDLE_TIMEOUT_MS,
    interruptWaitMs: env.HOMUNCULUS_INTERRUPT_WAIT_MS,
  };
  return Object.fromEntries(Object.entries(pick).flatMap(([k, v]) => (v ? [[k, Number(v)]] : [])));
}

export function endpointerOptions(): Partial<EndpointerOptions> {
  return {
    hangoverMs: num(env.HOMUNCULUS_VAD_HANGOVER_MS, 600),
    threshold: num(env.HOMUNCULUS_VAD_THRESHOLD, 0.5),
  };
}
