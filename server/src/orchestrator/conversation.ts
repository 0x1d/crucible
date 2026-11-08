// Conversation Orchestrator: per-device turn state machine (spec §5.2).
// uplink Opus → VAD endpointing + STT → agent → Speech Shaper → TTS → paced downlink; barge-in.
import { FrameFlag, type AudioFrame, type DeviceListen, type ServerMessage } from "@homunculus/protocol";
import type { ConnectionEvents, DeviceConnection } from "../gateway/connection.js";
import { Pacer } from "../gateway/pacer.js";
import type { AgentEvent, AgentSession, Usage } from "../inference/types.js";
import type { Logger } from "../log.js";
import { OpusDecoder, OpusFramer, type OpusRate } from "../speech/audio.js";
import { SpeechShaper, type ShaperOptions } from "../speech/shaper.js";
import type { SttProvider, SttStream, TtsProvider, VadModel } from "../speech/types.js";
import { defaultEndpointerOptions, VadSegmenter, type EndpointerOptions, type VadEvent } from "../speech/vad/endpointer.js";
import type { DeviceBridge } from "../tools/device-bridge.js";
import { TurnTimer } from "./latency.js";
import { SpeechOutput, type PacedItem } from "./speech-out.js";
import { settlesWithin, Watchdog, WatchdogError, within } from "./watchdog.js";

export type TurnState = "idle" | "listening" | "transcribing" | "running" | "speaking" | "error";

type AvatarState = "idle" | "listening" | "thinking" | "working" | "speaking" | "confirming" | "error";

/** The parts of a DeviceConnection the orchestrator uses (fakeable in tests). */
export type DeviceLink = Pick<DeviceConnection, "log" | "downlink" | "send" | "sendAudio"> & {
  on<K extends keyof ConnectionEvents>(event: K, listener: (...args: ConnectionEvents[K]) => void): unknown;
};

/** Orchestrator timeouts (spec §5.2); all wall clock. */
export interface ConversationTimeouts {
  /** No uplink frame for this long ends the utterance (device stopped streaming without Last/stop). */
  uplinkGapMs: number;
  /** Max wait for the final transcript after the endpoint. */
  sttFinalMs: number;
  /** Max time between two agent events (incl. session open). */
  agentIdleMs: number;
  /** Max time without speech progress (TTS chunk or downlink frame) while finishing a turn. */
  speechIdleMs: number;
  /** Max wait for the previous turn's agent stream to end after barge-in; then the session is reopened. */
  interruptWaitMs: number;
}

export const defaultTimeouts: ConversationTimeouts = {
  uplinkGapMs: 2500,
  sttFinalMs: 20_000,
  agentIdleMs: 90_000,
  speechIdleMs: 20_000,
  interruptWaitMs: 8000,
};

export interface ConversationDeps {
  stt: SttProvider;
  tts: TtsProvider;
  vad: VadModel;
  voice: string;
  language: string;
  /**
   * Opens an agent session: once at construction (prewarm), again after a fatal or
   * non-retryable agent error or a stuck interrupt, with the last backend session id
   * (undefined = fresh session).
   */
  openAgent(resumeSessionId: string | undefined): Promise<AgentSession>;
  /** Backend session id resumed by the first open. */
  resumeSessionId?: string | Promise<string | undefined>;
  endpointer?: Partial<EndpointerOptions>;
  shaper?: Partial<ShaperOptions>;
  /** Filler phrase when a tool starts and nothing was said for this long (spec §5.5); 0 disables. */
  fillerAfterMs?: number;
  fillerText?: string;
  apologyText?: string;
  /** Max wait for tts.played of the last segment before tts stop. */
  playedTimeoutMs?: number;
  prebufferFrames?: number;
  timeouts?: Partial<ConversationTimeouts>;
  /** Device tool bridge: its confirmations drive the `confirming` avatar state; barge-in denies them. */
  bridge?: Pick<DeviceBridge, "cancelConfirms"> & { onConfirmChange?: (waiting: boolean) => void };
}

const FRAME_MS = 60;
const PREROLL_FRAMES = 8; // ~480 ms of audio kept before speech start (auto mode)
/** Max wait for the previous agent session (open/close) when reopening. */
const REOPEN_WAIT_MS = 2000;

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
  /** Uplink stream id, latched from the first frame with the First flag (or seq 0). */
  streamId: number | undefined;
  /** Frames dropped: before the stream start or of another stream. */
  dropped: number;
  /** Wall-clock arrival of each uplink frame (maps VAD audio time to wall time). */
  arrivals: number[];
  gapTimer: NodeJS.Timeout | undefined;
  maxTimer: NodeJS.Timeout | undefined;
  final: Promise<string>;
}

interface Turn {
  id: number;
  text: string;
  reply: string;
  timer: TurnTimer;
  abort: AbortController;
  speech: SpeechOutput;
  shaper: SpeechShaper;
  tools: string[];
  aborted: boolean;
  filler: boolean;
  /** A tool started after speech began: avatar goes "working" once speech is idle, unless agent text followed. */
  working: boolean;
  agentEnded: boolean;
  usage?: Usage;
  error?: string;
  /** Settles when the agent stream for this turn has ended. */
  agentLoop: Promise<void>;
  endLoop(): void;
}

export class Conversation {
  state: TurnState = "idle";
  private utt: Utterance | undefined;
  private turn: Turn | undefined;
  /** Settles when every agent stream started so far has ended (barge-in ordering). */
  private lastAgentLoop: Promise<void> = Promise.resolve();
  /** heardSoFar of an interrupted answer, passed with the next utterance (spec §5.3.1). */
  private heardSoFar: string | undefined;
  private seq = 0;
  private segmentId = 0;
  private isClosed = false;
  private closing: Promise<string | undefined> | undefined;
  private avatarState: AvatarState | undefined;
  private agent: Promise<AgentSession>;
  /** Last known backend session id (resume on reopen). */
  private agentId: string | undefined;
  /** Consecutive agent failures; the second one in a row reopens without resume. */
  private agentFailures = 0;
  private speechWatchdog: Watchdog | undefined;
  private readonly decoder = new OpusDecoder(16000);
  private readonly framer: OpusFramer;
  private readonly pacer: Pacer<PacedItem>;
  private readonly log: Logger;
  private readonly opts: Required<
    Omit<ConversationDeps, "endpointer" | "openAgent" | "resumeSessionId" | "stt" | "tts" | "vad" | "timeouts" | "shaper" | "bridge">
  > & {
    endpointer: EndpointerOptions;
    shaper: Partial<ShaperOptions>;
    timeouts: ConversationTimeouts;
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
        this.speechWatchdog?.kick();
      },
      { prebufferFrames: deps.prebufferFrames ?? 3 },
    );
    this.opts = {
      voice: deps.voice,
      language: deps.language,
      endpointer: { ...defaultEndpointerOptions, ...deps.endpointer },
      shaper: deps.shaper ?? {},
      fillerAfterMs: deps.fillerAfterMs ?? 1500,
      fillerText: deps.fillerText ?? "One moment.",
      apologyText: deps.apologyText ?? "Sorry, something went wrong on my end.",
      playedTimeoutMs: deps.playedTimeoutMs ?? 1500,
      prebufferFrames: deps.prebufferFrames ?? 3,
      timeouts: { ...defaultTimeouts, ...deps.timeouts },
    };
    this.agent = this.trackAgent(
      Promise.resolve(deps.resumeSessionId).then((id) => {
        this.agentId = id;
        return deps.openAgent(id);
      }),
    );

    if (deps.bridge) {
      deps.bridge.onConfirmChange = (waiting) => {
        const turn = this.turn;
        if (!turn || turn.aborted) return;
        if (waiting) this.sendAvatar("confirming");
        else if (this.avatarState === "confirming") this.sendAvatar("working");
      };
    }

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
    link.on("close", () => void this.close());
    this.sendAvatar("idle");
  }

  private send(m: ServerMessage): void {
    if (!this.isClosed) this.link.send(m);
  }

  private sendAvatar(state: AvatarState, emote?: "concerned"): void {
    this.avatarState = state;
    this.send(emote ? { type: "avatar", state, emote } : { type: "avatar", state });
  }

  private setState(s: TurnState): void {
    if (this.state === s) return;
    this.log.debug("state", { from: this.state, to: s });
    this.state = s;
  }

  // ---------------------------------------------------------------------------
  // Agent session

  private trackAgent(p: Promise<AgentSession>): Promise<AgentSession> {
    p.then(
      (s) => {
        if (s.sessionId) this.agentId = s.sessionId;
      },
      (e: Error) => this.log.error("agent_open_failed", { error: e.message }),
    );
    return p;
  }

  /** Replaces a dead or wedged agent session; resumes the last session id once (spec §5.3.2). */
  private reopenAgent(reason: string): void {
    if (this.isClosed) return;
    const old = this.agent;
    this.agentFailures++;
    const failures = this.agentFailures;
    this.agent = this.trackAgent(
      (async () => {
        const s = await within(old, REOPEN_WAIT_MS);
        if (s?.sessionId) this.agentId = s.sessionId;
        if (s) await within(s.close(), REOPEN_WAIT_MS);
        const resume = failures >= 2 ? undefined : this.agentId;
        this.log.warn("agent_reopen", { reason, failures, resume: resume ?? null });
        return this.deps.openAgent(resume);
      })(),
    );
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
      streamId: undefined,
      dropped: 0,
      arrivals: [],
      gapTimer: undefined,
      maxTimer: undefined,
      final: new Promise((r) => (resolveFinal = r)),
    };
    this.utt = utt;
    const { uplinkGapMs } = this.opts.timeouts;
    this.armUplinkGap(utt);
    utt.maxTimer = setTimeout(
      () => this.uplinkTimeout(utt, "max_length"),
      this.opts.endpointer.maxUtteranceMs + uplinkGapMs,
    );
    this.setState("listening");
    this.sendAvatar("listening");
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

  private armUplinkGap(utt: Utterance): void {
    clearTimeout(utt.gapTimer);
    utt.gapTimer = setTimeout(() => this.uplinkTimeout(utt, "uplink_gap"), this.opts.timeouts.uplinkGapMs);
  }

  private clearUttTimers(utt: Utterance): void {
    clearTimeout(utt.gapTimer);
    clearTimeout(utt.maxTimer);
  }

  /** Wall-clock end of an utterance: the endpointer only counts audio time (spec §5.2). */
  private uplinkTimeout(utt: Utterance, reason: "uplink_gap" | "max_length"): void {
    if (utt !== this.utt || utt.ended) return;
    this.log.warn("uplink_timeout", { utterance: utt.id, reason, frames: utt.arrivals.length, speech: utt.speech });
    if (utt.mode === "auto" && !utt.speech) this.noSpeech(utt);
    else void this.endpoint(reason);
  }

  private onAudio(f: AudioFrame): void {
    const utt = this.utt;
    if (!utt || utt.ended) return;
    // Frames of an earlier stream (late after barge-in) or before the stream start are dropped.
    if (utt.streamId === undefined) {
      if (!(f.flags & FrameFlag.First) && f.seq !== 0) {
        utt.dropped++;
        return;
      }
      utt.streamId = f.streamId;
    } else if (f.streamId !== utt.streamId) {
      utt.dropped++;
      return;
    }
    this.armUplinkGap(utt);
    let pcm: Int16Array;
    try {
      pcm = this.decoder.decode(f.payload);
    } catch (e) {
      // Corrupt/oversized packet: substitute silence so audio timing stays intact.
      this.log.warn("opus_decode_failed", { error: (e as Error).message, bytes: f.payload.length });
      pcm = new Int16Array(960);
    }
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
        this.noSpeech(utt);
        break;
    }
  }

  private noSpeech(utt: Utterance): void {
    this.log.info("no_speech", { utterance: utt.id, dropped: utt.dropped });
    this.send({ type: "listen", state: "stop" });
    this.cancelUtterance();
    // The interrupting utterance yielded no turn: the interrupted answer is no longer context.
    this.heardSoFar = undefined;
    this.toIdle();
  }

  private cancelUtterance(): void {
    const utt = this.utt;
    if (!utt) return;
    utt.cancelled = utt.ended = true;
    this.clearUttTimers(utt);
    utt.stt.cancel();
    this.utt = undefined;
  }

  // ---------------------------------------------------------------------------
  // Transcribing

  private async endpoint(reason: string): Promise<void> {
    const utt = this.utt;
    if (!utt || utt.ended) return;
    utt.ended = true;
    this.clearUttTimers(utt);
    const { timer } = utt;
    timer.mark("endpoint");
    timer.mark("speech_end");
    if (utt.mode !== "manual") this.send({ type: "listen", state: "stop" });
    for (const p of utt.preroll) utt.stt.write(p);
    utt.preroll = [];
    this.setState("transcribing");
    // Immediate acknowledgement at endpoint (spec §5.5 mitigation).
    this.sendAvatar("thinking");
    utt.stt.end();
    const final = new Watchdog(this.opts.timeouts.sttFinalMs, "stt final");
    let text: string | undefined;
    try {
      text = await final.guard(utt.final);
    } catch {
      text = undefined;
    } finally {
      final.stop();
    }
    if (utt.cancelled || this.utt !== utt) return;
    this.utt = undefined;
    timer.mark("stt_final");
    const fields = { utterance: utt.id, reason, mode: utt.mode, dropped: utt.dropped };
    if (text === undefined) {
      utt.stt.cancel();
      this.log.error("stt_timeout", { ...fields, ms: this.opts.timeouts.sttFinalMs });
      const turn = this.newTurn("", timer);
      turn.error = "stt timeout";
      turn.endLoop();
      this.turn = turn;
      return this.finishTurn(turn);
    }
    this.send({ type: "stt", text, final: true });
    this.log.info("utterance", { ...fields, text });
    if (!text) {
      this.heardSoFar = undefined;
      this.logTurn(timer, { utterance: utt.id, empty: true });
      this.toIdle();
      return;
    }
    await this.runTurn(text, timer);
  }

  // ---------------------------------------------------------------------------
  // Running / Speaking

  private newTurn(text: string, timer: TurnTimer): Turn {
    let endLoop!: () => void;
    const agentLoop = new Promise<void>((r) => (endLoop = r));
    const turn: Turn = {
      id: this.seq,
      text,
      reply: "",
      timer,
      abort: new AbortController(),
      shaper: new SpeechShaper(this.opts.shaper),
      tools: [],
      aborted: false,
      filler: false,
      working: false,
      agentEnded: false,
      agentLoop,
      endLoop: () => {
        turn.agentEnded = true;
        turn.working = false;
        endLoop();
      },
      speech: new SpeechOutput({
        tts: this.deps.tts,
        voice: this.opts.voice,
        framer: this.framer,
        pacer: this.pacer,
        nextSegmentId: () => (this.segmentId = (this.segmentId % 0xffff) + 1),
        onSegmentStart: (id, segText, first, filler) => {
          timer.mark("first_audio");
          if (!filler) timer.mark("first_downlink");
          if (first) {
            this.setState("speaking");
            this.send({ type: "tts", state: "start" });
          }
          if (this.avatarState !== "speaking") this.sendAvatar("speaking");
          this.send({ type: "tts", state: "segment_start", segment_id: id, text: segText });
        },
        onSegmentEnd: (id) => this.send({ type: "tts", state: "segment_end", segment_id: id }),
        onChunk: (filler) => {
          if (!filler) timer.mark("tts_first_chunk");
          this.speechWatchdog?.kick();
        },
        log: this.log,
      }),
    };
    return turn;
  }

  private async runTurn(text: string, timer: TurnTimer): Promise<void> {
    const heardSoFar = this.heardSoFar;
    this.heardSoFar = undefined;
    const turn = this.newTurn(text, timer);
    this.turn = turn;
    this.setState("running");

    // The previous turns' agent streams must have ended before the next send (barge-in).
    // Chained, so a turn interrupted while waiting still holds back the one after it.
    const prev = this.lastAgentLoop;
    this.lastAgentLoop = Promise.all([prev, turn.agentLoop]).then(() => {});
    if (!(await settlesWithin(prev, this.opts.timeouts.interruptWaitMs)) && !turn.aborted) {
      this.log.warn("interrupt_timeout", { turn: turn.id, ms: this.opts.timeouts.interruptWaitMs });
      this.reopenAgent("interrupt_timeout");
      this.lastAgentLoop = turn.agentLoop;
    }
    if (turn.aborted) return turn.endLoop();

    await this.runAgent(turn, heardSoFar);
    if (turn.aborted) return;
    await this.finishTurn(turn);
  }

  private async runAgent(turn: Turn, heardSoFar: string | undefined): Promise<void> {
    const { timer, shaper } = turn;
    const say = (segments: string[]) => {
      for (const s of segments) {
        timer.mark("first_sentence");
        turn.speech.enqueue(s);
      }
    };
    const wd = new Watchdog(this.opts.timeouts.agentIdleMs, "agent");
    let fatal: string | undefined;
    let it: AsyncIterator<AgentEvent> | undefined;
    try {
      const session = await wd.guard(this.agent);
      if (turn.aborted) return;
      it = session.send({ kind: "utterance", text: turn.text, heardSoFar }, turn.abort.signal)[Symbol.asyncIterator]();
      // Events after an abort are drained (not acted on) so the session is idle for the next turn.
      for (;;) {
        const r = await wd.guard(it.next());
        if (r.done) break;
        wd.kick();
        const ev = r.value;
        if (ev.type === "error" && (ev.fatal || !ev.retryable)) fatal = ev.message;
        if (turn.aborted) continue;
        switch (ev.type) {
          case "status":
            this.send({ type: "agent.status", phase: ev.phase });
            break;
          case "text.delta":
            timer.mark("agent_first_token");
            turn.working = false;
            turn.reply += ev.text;
            say(shaper.push(ev.text));
            break;
          case "tool.start":
            turn.tools.push(ev.name);
            // Speak text preceding the tool call now (D-09 announcement); the next
            // assistant text block starts a new sentence.
            say(shaper.flush());
            if (turn.reply && !/\s$/.test(turn.reply)) turn.reply += " ";
            this.send({ type: "agent.status", phase: "tool", tool: ev.name });
            this.toolAvatar(turn);
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
            this.agentFailures = 0;
            say(shaper.flush());
            break;
          case "error":
            turn.error = ev.message;
            break;
        }
      }
    } catch (e) {
      fatal = (e as Error).message;
      if (!turn.aborted) turn.error = fatal;
      if (e instanceof WatchdogError) {
        // The stream is wedged: stop waiting for it; the session is replaced below.
        turn.abort.abort();
        void it?.return?.().catch(() => {});
      }
    } finally {
      wd.stop();
      turn.endLoop();
    }
    if (fatal !== undefined) this.reopenAgent(fatal);
  }

  /** Error apology, remaining speech, tts stop, back to idle. */
  private async finishTurn(turn: Turn): Promise<void> {
    const { timer } = turn;
    if (turn.error) {
      this.log.error("agent_error", { turn: turn.id, error: turn.error });
      this.setState("error");
      this.send({ type: "agent.status", phase: "error", detail: turn.error });
      this.sendAvatar("error", "concerned");
      // A sentence the agent had started is spoken before the apology.
      for (const s of turn.shaper.flush()) turn.speech.enqueue(s);
      turn.speech.enqueue(this.opts.apologyText, { filler: true });
    }
    const wd = new Watchdog(this.opts.timeouts.speechIdleMs, "speech");
    this.speechWatchdog = wd;
    try {
      await wd.guard(turn.speech.finish());
      if (turn.aborted) return;
      if (turn.speech.started) {
        await turn.speech.lastPlayed(this.opts.playedTimeoutMs);
        if (turn.aborted) return;
        this.send({ type: "tts", state: "stop" });
      }
    } catch (e) {
      // TTS or pacer stalled: drop the rest of the answer.
      if (turn.aborted) return;
      turn.error ??= (e as Error).message;
      this.log.error("speech_stalled", { turn: turn.id, error: (e as Error).message });
      turn.speech.cancel();
      this.pacer.clear();
      this.framer.reset();
      if (turn.speech.started) this.send({ type: "tts", state: "stop" });
      this.send({ type: "agent.status", phase: "error", detail: turn.error });
      this.sendAvatar("error", "concerned");
    } finally {
      wd.stop();
      if (this.speechWatchdog === wd) this.speechWatchdog = undefined;
    }
    if (!turn.error) this.send({ type: "agent.status", phase: "done" });
    timer.mark("turn_end");
    this.logTurn(timer, this.turnFields(turn));
    if (this.turn === turn) this.turn = undefined;
    this.toIdle();
  }

  /** Avatar "working" during tool use; while speaking, once the queued speech has played out. */
  private toolAvatar(turn: Turn): void {
    const already = turn.working;
    turn.working = true;
    const working = () => {
      if (this.turn === turn && turn.working && !turn.aborted && !turn.agentEnded && this.avatarState !== "working") {
        this.sendAvatar("working");
      }
    };
    if (this.state !== "speaking") working();
    // Speech queued or playing (e.g. a D-09 announcement): "working" once it has played out.
    if (turn.speech.active && !already) void turn.speech.finish().then(working);
  }

  /** Orchestrator filler when a tool starts and nothing was said recently (spec §5.5). */
  private maybeFiller(turn: Turn): void {
    if (turn.filler || this.opts.fillerAfterMs <= 0) return;
    const since = turn.speech.lastEnqueuedAt ?? turn.timer.get("endpoint") ?? performance.now();
    if (performance.now() - since < this.opts.fillerAfterMs) return;
    turn.filler = true;
    turn.timer.mark("filler");
    turn.speech.enqueue(this.opts.fillerText, { filler: true });
  }

  // ---------------------------------------------------------------------------
  // Barge-in / abort

  /** Interrupts the running turn: agent interrupt, pacer cleared, tts stop (spec §5.2 barge-in). */
  private bargeIn(reason: string): void {
    const turn = this.turn;
    if (!turn) return;
    turn.aborted = true;
    turn.working = false;
    turn.abort.abort(); // → AgentSession.interrupt()
    this.deps.bridge?.cancelConfirms();
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
    this.sendAvatar("idle");
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

  /**
   * Ends the conversation (disconnect or replaced by a newer connection of the same device):
   * cancels the turn, closes the agent session; resolves with its backend session id.
   */
  close(): Promise<string | undefined> {
    if (this.closing) return this.closing;
    this.isClosed = true;
    if (this.utt) this.cancelUtterance();
    if (this.turn) this.bargeIn("disconnect");
    this.pacer.clear();
    this.decoder.delete();
    this.framer.delete();
    this.closing = (async () => {
      const s = await within(this.agent, REOPEN_WAIT_MS);
      if (s?.sessionId) this.agentId = s.sessionId;
      if (s) await within(s.close(), REOPEN_WAIT_MS);
      return this.agentId;
    })();
    return this.closing;
  }
}
