// Speech provider interfaces (spec §5.4). Implementations are selected by configuration.

export interface SttResult {
  text: string;
  final: boolean;
}

export interface SttProvider {
  readonly id: string;
  open(opts: { language?: string; sampleRate: 16000 }): SttStream;
  /** Loads models / starts processes ahead of the first utterance. */
  warmup?(): Promise<void>;
  close?(): Promise<void>;
}

export interface SttStream {
  write(pcm: Int16Array): void;
  /** End of utterance: the final result follows. */
  end(): void;
  /** Partials while audio is written, then exactly one final result. */
  results(): AsyncIterable<SttResult>;
  /** Discards the utterance (abort); results() ends without a final. */
  cancel(): void;
  /** Server VAD state; pseudo-streaming providers schedule partials while speech is ongoing. */
  vadHint?(speaking: boolean): void;
}

export interface TtsProvider {
  readonly id: string;
  /** Yields PCM16 mono at `sampleRate`. Stops early when `signal` aborts. */
  synthesize(text: string, opts: { voice: string; sampleRate: number; signal: AbortSignal }): AsyncIterable<Int16Array>;
  warmup?(voice: string): Promise<void>;
  close?(): Promise<void>;
}

/** Frame-level voice activity model (e.g. Silero): speech probability per window. */
export interface VadModel {
  /** Window length in samples at 16 kHz. */
  readonly windowSamples: number;
  /** One stateful stream per utterance. */
  stream(): VadModelStream;
}

export interface VadModelStream {
  probability(window: Float32Array): Promise<number>;
}
