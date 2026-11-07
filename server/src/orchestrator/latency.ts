// Per-turn stage timestamps (spec §5.8: structured logs per turn for latency budget tracking).

export const STAGES = [
  "listen_start",
  "speech_start",
  "speech_end",
  "endpoint",
  "stt_final",
  "agent_first_token",
  "first_sentence",
  "tts_first_chunk",
  "first_downlink",
  "agent_done",
  "turn_end",
] as const;

export type Stage = (typeof STAGES)[number];

export class TurnTimer {
  private readonly marks = new Map<Stage, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Records the first occurrence of a stage (later calls are ignored). */
  mark(stage: Stage, at = this.now()): void {
    if (!this.marks.has(stage)) this.marks.set(stage, at);
  }

  has(stage: Stage): boolean {
    return this.marks.has(stage);
  }

  get(stage: Stage): number | undefined {
    return this.marks.get(stage);
  }

  /**
   * Log fields: every stage in ms after end of user speech (`t_<stage>`), plus stage
   * durations: VAD hangover, STT, agent time to first token, TTS of the first sentence.
   */
  fields(): Record<string, number> {
    const ref = this.marks.get("speech_end") ?? this.marks.get("endpoint");
    const out: Record<string, number> = {};
    if (ref === undefined) return out;
    for (const s of STAGES) {
      const v = this.marks.get(s);
      if (v !== undefined && s !== "speech_end") out[`t_${s}`] = Math.round(v - ref);
    }
    const d = (name: string, a: Stage, b: Stage) => {
      const va = this.marks.get(a);
      const vb = this.marks.get(b);
      if (va !== undefined && vb !== undefined) out[name] = Math.round(vb - va);
    };
    d("hangover_ms", "speech_end", "endpoint");
    d("stt_ms", "endpoint", "stt_final");
    d("agent_ttft_ms", "stt_final", "agent_first_token");
    d("agent_first_sentence_ms", "stt_final", "first_sentence");
    d("tts_first_ms", "first_sentence", "tts_first_chunk");
    return out;
  }
}
