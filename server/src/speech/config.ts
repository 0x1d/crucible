// Speech pipeline configuration (spec §5.4): provider selection via environment.
import type { Logger } from "../log.js";
import { modelDir } from "./paths.js";
import { WhisperCppProvider } from "./stt/whisper-cpp.js";
import { KokoroTtsProvider } from "./tts/kokoro.js";
import { PiperTtsProvider } from "./tts/piper.js";
import type { SttProvider, TtsProvider, VadModel } from "./types.js";
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

/** TTS provider: HOMUNCULUS_TTS overrides the persona's provider. */
export function createTts(personaProvider: string, log: Logger): TtsProvider {
  const provider = env.HOMUNCULUS_TTS ?? personaProvider;
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

export function endpointerOptions(): Partial<EndpointerOptions> {
  return {
    hangoverMs: num(env.HOMUNCULUS_VAD_HANGOVER_MS, 600),
    threshold: num(env.HOMUNCULUS_VAD_THRESHOLD, 0.5),
  };
}
