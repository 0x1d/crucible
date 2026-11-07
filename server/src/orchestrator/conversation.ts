// Conversation Orchestrator: per-device turn state machine (spec §5.2).
// uplink Opus → VAD endpointing + STT → agent → Speech Shaper → TTS → paced downlink; barge-in.
import { FrameFlag, type AudioFrame, type DeviceListen, type ServerMessage } from "@homunculus/protocol";
import type { ConnectionEvents, DeviceConnection } from "../gateway/connection.js";
import { Pacer } from "../gateway/pacer.js";
import type { AgentSession, Usage } from "../inference/types.js";
import type { Logger } from "../log.js";
import { OpusDecoder, OpusFramer, type OpusRate } from "../speech/audio.js";
import { SpeechShaper } from "../speech/shaper.js";
import type { SttProvider, SttStream, TtsProvider, VadModel } from "../speech/types.js";
import { defaultEndpointerOptions, VadSegmenter, type EndpointerOptions, type VadEvent } from "../speech/vad/endpointer.js";
import { TurnTimer } from "./latency.js";
import { SpeechOutput, type PacedItem } from "./speech-out.js";

export type TurnState = "idle" | "listening" | "transcribing" | "running" | "speaking" | "error";

/** The parts of a DeviceConnection the orchestrator uses (fakeable in tests). */
export type DeviceLink = Pick<DeviceConnection, "log" | "downlink" | "send" | "sendAudio"> & {
  on<K extends keyof ConnectionEvents>(event: K, listener: (...args: ConnectionEvents[K]) => void): unknown;
};

export interface ConversationDeps {
  stt: SttProvider;
  tts: TtsProvider;
  vad: VadModel;
  voice: string;
  language: string;
  /** Agent session for this device; opened when the device is ready (prewarm). */
  agent: Promise<AgentSession>;
  endpointer?: Partial<EndpointerOptions>;
  /** Filler phrase when a tool starts and nothing was said for this long (spec §5.5); 0 disables. */
  fillerAfterMs?: number;
  fillerText?: string;
  apologyText?: string;
  /** Max wait for tts.played of the last segment before tts stop. */
  playedTimeoutMs?: number;
  prebufferFrames?: number;
}

const FRAME_MS = 60;
const PREROLL_FRAMES = 8; // ~480 ms of audio kept before speech start (auto mode)

interface Utterance {
  id: number;
  mode: NonNullable<DeviceListen["mode"]>;
  stt: SttStream;
  vad: VadSegmenter;
  timer: TurnTimer;
  preroll: Int16Array[];
  speech: boolean;
  ended: boolean;
  cancelled: boolean;
  /** Wall-clock arrival of each uplink frame (maps VAD audio time to wall time). */
  arrivals: number[];
  final: Promise<string>;
}

interface Turn {
  id: number;
  text: string;
  reply: string;
  timer: TurnTimer;
  abort: AbortController;
  speech: SpeechOutput;
  tools: string[];
  aborted: boolean;
  filler: boolean;
  usage?: Usage;
  error?: string;
  /** Settles when the agent stream for this turn has ended. */
  agentLoop: Promise<void>;
}

export class Conversation {
  state: TurnState = "idle";
  private utt: Utterance | undefined;
  private turn: Turn | undefined;
  private lastAgentLoop: Promise<void> = Promise.resolve();
  /** heardSoFar of an interrupted answer, passed with the next utterance (spec §5.3.1). */
  private heardSoFar: string | undefined;
  private seq = 0;
  private segmentId = 0;
  private closed = false;
  private readonly decoder = new OpusDecoder(16000);
  private readonly framer: OpusFramer;
  private readonly pacer: Pacer<PacedItem>;
  private readonly log: Logger;
  private readonly opts: Required<Omit<ConversationDeps, "endpointer" | "agent" | "stt" | "tts" | "vad">> & {
    endpointer: EndpointerOptions;
  };

  constructor(
    private readonly link: DeviceLink,
    private readonly deps: ConversationDeps,
  ) {
    this.log = link.log.child({ component: "orchestrator" });
    this.framer = new OpusFramer((link.downlink?.sample_rate ?? 24000) as OpusRate);
    this.pacer = new Pacer<PacedItem>(
      (item) => {
        item.before?.();
        link.sendAudio(item.frame);
        item.after?.();
      },
      { prebufferFrames: deps.prebufferFrames ?? 3 },
    );
    this.opts = {
      voice: deps.voice,
      language: deps.language,
      endpointer: { ...defaultEndpointerOptions, ...deps.endpointer },
      fillerAfterMs: deps.fillerAfterMs ?? 1500,
      fillerText: deps.fillerText ?? "One moment.",
      apologyText: deps.apologyText ?? "Sorry, something went wrong on my end.",
      playedTimeoutMs: deps.playedTimeoutMs ?? 1500,
      prebufferFrames: deps.prebufferFrames ?? 3,
    };
    deps.agent.catch((e: Error) => this.log.error("agent_open_failed", { error: e.message }));

    link.on("message", (m) => {
      switch (m.type) {
        case "listen":
          if (m.state === "start") this.startListening(m);
          else void this.endpoint("listen_stop");
          break;
        case "abort":
          this.abort(m.reason);
          break;
        case "tts.played":
          this.turn?.speech.played(m.segment_id);
          break;
        default:
          this.log.debug("unhandled", { type: m.type });
      }
    });
    link.on("audio", (f) => this.onAudio(f));
    link.on("close", () => this.close());
    this.send({ type: "avatar", state: "idle" });
  }

  private send(m: ServerMessage): void {
    if (!this.closed) this.link.send(m);
  }

  private setState(s: TurnState): void {
    if (this.state === s) return;
    this.log.debug("state", { from: this.state, to: s });
    this.state = s;
  }

  // ---------------------------------------------------------------------------
  // Listening

  private startListening(m: DeviceListen): void {
    if (this.turn) this.bargeIn("listen_start");
    if (this.utt) this.cancelUtterance();
    const timer = new TurnTimer();
    timer.mark("listen_start");
    const stt = this.deps.stt.open({ language: this.opts.language, sampleRate: 16000 });
    let resolveFinal!: (t: string) => void;
    const utt: Utterance = {
      id: ++this.seq,
      mode: m.mode ?? "auto",
      stt,
      vad: new VadSegmenter(this.deps.vad, this.opts.endpointer),
      timer,
      preroll: [],
      speech: false,
      ended: false,
      cancelled: false,
      arrivals: [],
      final: new Promise((r) => (resolveFinal = r)),
    };
    this.utt = utt;
    this.setState("listening");
    this.send({ type: "avatar", state: "listening" });
    void (async () => {
      let final = "";
      for await (const r of stt.results()) {
        if (utt.cancelled) break;
        if (r.final) {
          final = r.text;
          break;
        }
        this.send({ type: "stt", text: r.text, final: false });
      }
      resolveFinal(final);
    })();
  }

  private onAudio(f: AudioFrame): void {
    const utt = this.utt;
    if (!utt || utt.ended) return;
    const pcm = this.decoder.decode(f.payload);
    utt.arrivals.push(performance.now());
    if (utt.mode !== "auto" || utt.speech) utt.stt.write(pcm);
    else {
      utt.preroll.push(pcm);
      if (utt.preroll.length > PREROLL_FRAMES) utt.preroll.shift();
    }
    utt.vad.push(pcm).then(
      (events) => {
        for (const ev of events) this.onVad(utt, ev);
      },
      (e: Error) => this.log.warn("vad_failed", { error: e.message }),
    );
    if (f.flags & FrameFlag.Last && utt.mode !== "manual") void this.endpoint("last_frame");
  }

  /** Wall-clock time at which the uplink audio position `audioMs` arrived. */
  private wallAt(utt: Utterance, audioMs: number): number {
    const i = Math.min(utt.arrivals.length - 1, Math.max(0, Math.floor(audioMs / FRAME_MS)));
    return utt.arrivals[i] ?? performance.now();
  }

  private onVad(utt: Utterance, ev: VadEvent): void {
    if (utt !== this.utt || utt.ended) return;
    switch (ev.type) {
      case "speech_start":
        utt.speech = true;
        utt.timer.mark("speech_start", this.wallAt(utt, ev.atMs));
        for (const p of utt.preroll) utt.stt.write(p);
        utt.preroll = [];
        utt.stt.vadHint?.(true);
        break;
      case "pause":
        utt.stt.vadHint?.(false);
        break;
      case "resume":
        utt.stt.vadHint?.(true);
        break;
      case "endpoint":
        if (utt.mode !== "auto") break;
        utt.timer.mark("speech_end", this.wallAt(utt, ev.speechEndMs + FRAME_MS));
        void this.endpoint(ev.reason === "silence" ? "vad" : "max_length");
        break;
      case "no_speech":
        if (utt.mode !== "auto") break;
        this.log.info("no_speech", { utterance: utt.id });
        this.send({ type: "listen", state: "stop" });
        this.cancelUtterance();
        this.toIdle();
        break;
    }
  }

  private cancelUtterance(): void {
    const utt = this.utt;
    if (!utt) return;
    utt.cancelled = utt.ended = true;
    utt.stt.cancel();
    this.utt = undefined;
  }

  // ---------------------------------------------------------------------------
  // Transcribing

  private async endpoint(reason: string): Promise<void> {
    const utt = this.utt;
    if (!utt || utt.ended) return;
    utt.ended = true;
    const { timer } = utt;
    timer.mark("endpoint");
    timer.mark("speech_end");
    if (utt.mode !== "manual") this.send({ type: "listen", state: "stop" });
    for (const p of utt.preroll) utt.stt.write(p);
    utt.preroll = [];
    this.setState("transcribing");
    // Immediate acknowledgement at endpoint (spec §5.5 mitigation).
    this.send({ type: "avatar", state: "thinking" });
    utt.stt.end();
    const text = await utt.final;
    if (utt.cancelled || this.utt !== utt) return;
    this.utt = undefined;
    timer.mark("stt_final");
    this.send({ type: "stt", text, final: true });
    this.log.info("utterance", { utterance: utt.id, reason, mode: utt.mode, text });
    if (!text) {
      this.logTurn(timer, { utterance: utt.id, empty: true });
      this.toIdle();
      return;
    }
    await this.runTurn(text, timer);
  }

  // ---------------------------------------------------------------------------
  // Running / Speaking

  private async runTurn(text: string, timer: TurnTimer): Promise<void> {
    const heardSoFar = this.heardSoFar;
    this.heardSoFar = undefined;
    const abort = new AbortController();
    let endLoop!: () => void;
    const turn: Turn = {
      id: this.seq,
      text,
      reply: "",
      timer,
      abort,
      tools: [],
      aborted: false,
      filler: false,
      agentLoop: new Promise((r) => (endLoop = r)),
      speech: new SpeechOutput({
        tts: this.deps.tts,
        voice: this.opts.voice,
        framer: this.framer,
        pacer: this.pacer,
        nextSegmentId: () => (this.segmentId = (this.segmentId % 0xffff) + 1),
        onSegmentStart: (id, segText, first) => {
          if (first) {
            timer.mark("first_downlink");
            this.setState("speaking");
            this.send({ type: "avatar", state: "speaking" });
            this.send({ type: "tts", state: "start" });
          }
          this.send({ type: "tts", state: "segment_start", segment_id: id, text: segText });
        },
        onSegmentEnd: (id) => this.send({ type: "tts", state: "segment_end", segment_id: id }),
        onFirstChunk: () => timer.mark("tts_first_chunk"),
        log: this.log,
      }),
    };
    this.turn = turn;
    this.setState("running");

    // The previous turn's agent stream must have ended before the next send (barge-in).
    const prev = this.lastAgentLoop;
    this.lastAgentLoop = turn.agentLoop;
    await Promise.race([prev, new Promise((r) => setTimeout(r, 3000))]);
    if (turn.aborted) return endLoop();

    try {
      const session = await this.deps.agent;
      if (turn.aborted) return;
      const shaper = new SpeechShaper();
      const say = (segments: string[]) => {
        for (const s of segments) {
          timer.mark("first_sentence");
          turn.speech.enqueue(s);
        }
      };
      // Events after an abort are drained (not acted on) so the session is idle for the next turn.
      for await (const ev of session.send({ kind: "utterance", text, heardSoFar }, abort.signal)) {
        if (turn.aborted) continue;
        switch (ev.type) {
          case "status":
            this.send({ type: "agent.status", phase: ev.phase });
            break;
          case "text.delta":
            timer.mark("agent_first_token");
            turn.reply += ev.text;
            say(shaper.push(ev.text));
            break;
          case "tool.start":
            turn.tools.push(ev.name);
            this.send({ type: "agent.status", phase: "tool", tool: ev.name });
            if (this.state === "running") this.send({ type: "avatar", state: "working" });
            this.maybeFiller(turn);
            break;
          case "tool.end":
            break;
          case "permission.request":
            this.log.warn("permission_request_unsupported", { tool: ev.tool });
            break;
          case "done":
            timer.mark("agent_done");
            turn.usage = ev.usage;
            say(shaper.flush());
            break;
          case "error":
            turn.error = ev.message;
            break;
        }
      }
    } catch (e) {
      turn.error = (e as Error).message;
    } finally {
      endLoop();
    }
    if (turn.aborted) return;

    if (turn.error) {
      this.log.error("agent_error", { turn: turn.id, error: turn.error });
      this.setState("error");
      this.send({ type: "agent.status", phase: "error", detail: turn.error });
      this.send({ type: "avatar", state: "error", emote: "concerned" });
      turn.speech.enqueue(this.opts.apologyText);
    }
    await turn.speech.finish();
    if (turn.aborted) return;
    if (turn.speech.started) {
      await turn.speech.lastPlayed(this.opts.playedTimeoutMs);
      if (turn.aborted) return;
      this.send({ type: "tts", state: "stop" });
    }
    if (!turn.error) this.send({ type: "agent.status", phase: "done" });
    timer.mark("turn_end");
    this.logTurn(timer, this.turnFields(turn));
    this.turn = undefined;
    this.toIdle();
  }

  /** Orchestrator filler when a tool starts and nothing was said recently (spec §5.5). */
  private maybeFiller(turn: Turn): void {
    if (turn.filler || this.opts.fillerAfterMs <= 0) return;
    const since = turn.speech.lastEnqueuedAt ?? turn.timer.get("endpoint") ?? performance.now();
    if (performance.now() - since < this.opts.fillerAfterMs) return;
    turn.filler = true;
    turn.timer.mark("first_sentence");
    turn.speech.enqueue(this.opts.fillerText);
  }

  // ---------------------------------------------------------------------------
  // Barge-in / abort

  /** Interrupts the running turn: agent interrupt, pacer cleared, tts stop (spec §5.2 barge-in). */
  private bargeIn(reason: string): void {
    const turn = this.turn;
    if (!turn) return;
    turn.aborted = true;
    turn.abort.abort(); // → AgentSession.interrupt()
    turn.speech.cancel();
    this.pacer.clear();
    this.framer.reset();
    this.heardSoFar = turn.speech.heardText();
    if (turn.speech.started) this.send({ type: "tts", state: "stop" });
    turn.timer.mark("turn_end");
    this.logTurn(turn.timer, { ...this.turnFields(turn), interrupted: reason, heard_chars: this.heardSoFar.length });
    this.turn = undefined;
  }

  private abort(reason: string): void {
    this.log.info("abort", { reason, state: this.state });
    if (this.utt) this.cancelUtterance();
    this.bargeIn(reason);
    this.toIdle();
  }

  private toIdle(): void {
    this.setState("idle");
    this.send({ type: "avatar", state: "idle" });
  }

  private turnFields(turn: Turn): Record<string, unknown> {
    return {
      turn: turn.id,
      text: turn.text,
      reply: turn.reply,
      tools: turn.tools,
      segments: turn.speech.segments.length,
      ...(turn.usage?.costUsd !== undefined ? { cost_usd: turn.usage.costUsd } : {}),
      ...(turn.error ? { error: turn.error } : {}),
    };
  }

  private logTurn(timer: TurnTimer, fields: Record<string, unknown>): void {
    this.log.info("turn", { ...timer.fields(), ...fields });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.utt) this.cancelUtterance();
    if (this.turn) this.bargeIn("disconnect");
    this.pacer.clear();
    this.decoder.delete();
    this.framer.delete();
  }
}
