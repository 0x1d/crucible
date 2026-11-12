// Simulated HDP device: connection, hello, keep-alive, reconnect with resume,
// uplink streaming, downlink decoding, device tools and per-turn timing.
import { EventEmitter } from "node:events";
import {
  decodeFrame,
  encodeFrame,
  FrameFlag,
  FrameType,
  HDP_SUBPROTOCOL,
  HDP_VERSION,
  parseServerMessage,
  type AudioFrame,
  type DeviceHello,
  type DeviceMessage,
  type ServerHello,
  type ServerMessage,
  type ToolCall,
} from "@homunculus/protocol";
import OpusScript from "opusscript";
import WebSocket from "ws";
import { FRAME_SAMPLES_16K, UPLINK_RATE } from "./audio.js";

export interface SimOptions {
  url: string;
  token: string;
  deviceId: string;
  model: string;
  firmware: string;
  /** Auto-approve confirmation requests. */
  autoConfirm: boolean;
}

export interface TurnTimings {
  /** ms from end of user speech (last speech frame sent / listen stop) to each event. */
  [stage: string]: number;
}

type Events = {
  connected: [ServerHello];
  disconnected: [code: number];
  message: [ServerMessage];
  /** Decoded downlink PCM of one segment, delivered per frame. */
  pcm: [segmentId: number, pcm: Int16Array];
  segment: [segmentId: number, pcm: Int16Array, text: string | undefined];
  turnEnd: [TurnTimings];
  confirm: [requestId: string, title: string, detail: string];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimDevice extends EventEmitter<Events> {
  volume = 70;
  session: ServerHello | undefined;
  private ws: WebSocket | undefined;
  private keepalive: NodeJS.Timeout | undefined;
  private backoffMs = 1000;
  private closing = false;
  private readonly encoder = new OpusScript(UPLINK_RATE, 1, OpusScript.Application.VOIP);
  private decoder: OpusScript | undefined;
  private streamId = 0;
  private listening = false;
  private segments = new Map<number, { text?: string; pcm: Int16Array[]; firstFrameAt?: number }>();
  private timing: { t0?: number; marks: TurnTimings } = { marks: {} };

  constructor(private readonly opts: SimOptions) {
    super();
  }

  // -------------------------------------------------------------------------
  // Connection

  connect(): Promise<ServerHello> {
    this.closing = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url, HDP_SUBPROTOCOL, {
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          "X-Device-Id": this.opts.deviceId,
          "X-Device-Model": this.opts.model,
          "X-Firmware": this.opts.firmware,
        },
      });
      this.ws = ws;
      let established = false;
      ws.on("open", () => ws.send(JSON.stringify(this.hello())));
      ws.on("unexpected-response", (_req, res) => reject(new Error(`upgrade rejected: HTTP ${res.statusCode}`)));
      ws.on("error", (err) => {
        if (!established) reject(err);
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) return this.onAudio(decodeFrame(new Uint8Array(data as Buffer)));
        const r = parseServerMessage(data.toString());
        if (!r.ok) {
          if (r.kind === "invalid") console.error(`! invalid server message: ${r.error}`);
          return;
        }
        const m = r.message;
        if (m.type === "hello" && !established) {
          established = true;
          this.session = m;
          this.backoffMs = 1000;
          this.decoder = new OpusScript(m.audio.output.sample_rate as 16000 | 24000, 1);
          this.keepalive = setInterval(() => ws.ping(), 20_000);
          this.emit("connected", m);
          resolve(m);
          return;
        }
        this.onMessage(m);
      });
      ws.on("close", (code) => {
        clearInterval(this.keepalive);
        this.listening = false;
        this.emit("disconnected", code);
        if (established && !this.closing) void this.reconnect();
      });
    });
  }

  /** Exponential backoff 1 s → 60 s with jitter; resumes the session (spec §4.1). */
  private async reconnect(): Promise<void> {
    while (!this.closing) {
      const delay = this.backoffMs * (0.5 + Math.random() / 2);
      this.backoffMs = Math.min(60_000, this.backoffMs * 2);
      await sleep(delay);
      try {
        await this.connect();
        return;
      } catch (e) {
        console.error(`! reconnect failed: ${(e as Error).message}`);
      }
    }
  }

  async close(reason = "user_quit"): Promise<void> {
    this.closing = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "goodbye", reason });
      await new Promise<void>((resolve) => {
        this.ws?.once("close", () => resolve());
        this.ws?.close(1000);
        setTimeout(resolve, 1000);
      });
    }
  }

  send(m: DeviceMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private hello(): DeviceHello {
    return {
      type: "hello",
      version: HDP_VERSION,
      device: { model: this.opts.model, firmware: this.opts.firmware, board: "pc/simulator" },
      capabilities: {
        display: { width: 466, height: 466, shape: "round", color_depth: 16 },
        audio: {
          input: { format: "opus", sample_rate: UPLINK_RATE, channels: 1, frame_ms: 60 },
          output: { formats: ["opus"], sample_rates: [16000, 24000] },
          mics: 1,
          aec: false,
          wake_word: false,
        },
        input: ["keyboard"],
        power: { battery: false },
        avatar: {
          engine: "homunculus-face/1",
          emotes: ["neutral", "happy", "sad", "surprised", "curious", "concerned", "confused", "excited", "sleepy", "love", "angry"],
        },
      },
      tools: [
        {
          name: "device.set_volume",
          description: "Set speaker volume",
          inputSchema: {
            type: "object",
            properties: { level: { type: "integer", minimum: 0, maximum: 100 } },
            required: ["level"],
          },
        },
        {
          name: "device.get_status",
          description: "Get device status (volume, battery)",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      ...(this.session ? { resume: { session_id: this.session.session_id } } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Uplink

  /**
   * Streams PCM16 16 kHz as one utterance in real time.
   * auto: after the audio, keeps sending silence until the server sends listen.stop
   * (at most `tailMs`), then a last frame. manual: sends listen.stop after the audio.
   */
  async talk(
    pcm: Int16Array,
    opts: { mode: "auto" | "manual"; trigger?: "wake_word" | "touch" | "button"; tailMs?: number },
  ): Promise<void> {
    const stream = (this.streamId = (this.streamId + 1) & 0xffff);
    this.listening = true;
    this.timing = { marks: {} };
    this.send({
      type: "listen",
      state: "start",
      mode: opts.mode,
      trigger: opts.trigger ?? "button",
      ...(opts.trigger === "wake_word" ? { wake_word: "computer" } : {}),
    });
    const frameCount = Math.ceil(pcm.length / FRAME_SAMPLES_16K);
    const silence = new Int16Array(FRAME_SAMPLES_16K);
    const start = performance.now();
    let seq = 0;
    const sendFrame = async (samples: Int16Array, last: boolean) => {
      const due = start + seq * 60;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      const payload = this.encoder.encode(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength), FRAME_SAMPLES_16K);
      let flags = 0;
      if (seq === 0) flags |= FrameFlag.First;
      if (last) flags |= FrameFlag.Last;
      this.ws?.send(encodeFrame({ type: FrameType.OpusUplink, flags, streamId: stream, seq, payload }));
      seq++;
    };

    for (let i = 0; i < frameCount && this.listening; i++) {
      const frame = new Int16Array(FRAME_SAMPLES_16K);
      frame.set(pcm.subarray(i * FRAME_SAMPLES_16K, (i + 1) * FRAME_SAMPLES_16K));
      const last = opts.mode === "manual" && i === frameCount - 1;
      await sendFrame(frame, last);
    }
    this.timing.t0 = performance.now();
    if (opts.mode === "manual") {
      this.listening = false;
      this.send({ type: "listen", state: "stop" });
      return;
    }
    const tailFrames = Math.ceil((opts.tailMs ?? 1500) / 60);
    for (let i = 0; i < tailFrames && this.listening; i++) await sendFrame(silence, false);
    if (this.listening) {
      // Server did not endpoint within the tail: end the stream ourselves.
      this.listening = false;
      await sendFrame(silence, true);
    }
  }

  /** Streams live frames (mic). Returns a function that ends the utterance. */
  startLive(opts: { mode: "auto" | "manual" }): { push(pcm: Int16Array): void; stop(): void } {
    const stream = (this.streamId = (this.streamId + 1) & 0xffff);
    this.listening = true;
    this.timing = { marks: {} };
    this.send({ type: "listen", state: "start", mode: opts.mode, trigger: "button" });
    let seq = 0;
    const encode = (pcm: Int16Array) => this.encoder.encode(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), FRAME_SAMPLES_16K);
    return {
      push: (pcm) => {
        if (!this.listening) return;
        const flags = seq === 0 ? FrameFlag.First : 0;
        this.ws?.send(encodeFrame({ type: FrameType.OpusUplink, flags, streamId: stream, seq: seq++, payload: encode(pcm) }));
      },
      stop: () => {
        if (!this.listening) return;
        this.listening = false;
        this.timing.t0 = performance.now();
        this.ws?.send(
          encodeFrame({ type: FrameType.OpusUplink, flags: FrameFlag.Last, streamId: stream, seq: seq++, payload: encode(new Int16Array(FRAME_SAMPLES_16K)) }),
        );
        this.send({ type: "listen", state: "stop" });
      },
    };
  }

  abort(reason: "barge_in" | "user_cancel" = "user_cancel"): void {
    this.listening = false;
    this.segments.clear();
    this.send({ type: "abort", reason });
  }

  // -------------------------------------------------------------------------
  // Downlink

  private mark(stage: string): void {
    if (this.timing.t0 === undefined || stage in this.timing.marks) return;
    this.timing.marks[stage] = Math.round(performance.now() - this.timing.t0);
  }

  private onMessage(m: ServerMessage): void {
    this.emit("message", m);
    switch (m.type) {
      case "listen":
        if (this.listening) {
          this.listening = false;
          this.timing.t0 ??= performance.now();
        }
        this.mark("listen.stop");
        break;
      case "stt":
        if (m.final) this.mark("stt.final");
        break;
      case "agent.status":
        this.mark(`agent.${m.phase}`);
        break;
      case "tts":
        if (m.state === "segment_start" && m.segment_id !== undefined) {
          this.mark("tts.segment_start");
          this.segments.set(m.segment_id, { text: m.text, pcm: [] });
        } else if (m.state === "segment_end" && m.segment_id !== undefined) {
          void this.finishSegment(m.segment_id);
        } else if (m.state === "stop") {
          this.mark("tts.stop");
          const marks = this.timing.marks;
          if (this.timing.t0 !== undefined) this.emit("turnEnd", marks);
          this.timing = { marks: {} };
        }
        break;
      case "tool.call":
        this.onToolCall(m);
        break;
      case "confirm.request":
        if (this.opts.autoConfirm) this.send({ type: "confirm.result", request_id: m.request_id, approved: true });
        else this.emit("confirm", m.request_id, m.title, m.detail);
        break;
    }
  }

  private onAudio(f: AudioFrame): void {
    if (f.type !== FrameType.OpusDownlink || !this.decoder) return;
    this.mark("audio.first");
    let seg = this.segments.get(f.streamId);
    if (!seg) {
      seg = { pcm: [] };
      this.segments.set(f.streamId, seg);
    }
    seg.firstFrameAt ??= performance.now();
    const out = this.decoder.decode(Buffer.from(f.payload));
    const pcm = new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    seg.pcm.push(pcm);
    this.emit("pcm", f.streamId, pcm);
  }

  /** Reports tts.played once the segment's audio would have finished playing in real time. */
  private async finishSegment(id: number): Promise<void> {
    const seg = this.segments.get(id);
    if (!seg) return;
    const rate = this.session?.audio.output.sample_rate ?? 24000;
    const samples = seg.pcm.reduce((n, p) => n + p.length, 0);
    const all = new Int16Array(samples);
    let off = 0;
    for (const p of seg.pcm) {
      all.set(p, off);
      off += p.length;
    }
    this.emit("segment", id, all, seg.text);
    const playEnd = (seg.firstFrameAt ?? performance.now()) + (samples / rate) * 1000;
    await sleep(Math.max(0, playEnd - performance.now()));
    if (this.segments.delete(id)) this.send({ type: "tts.played", segment_id: id });
  }

  private onToolCall(m: ToolCall): void {
    const { id, method, params } = m.payload;
    const reply = (body: { result: unknown } | { error: { code: number; message: string } }) =>
      this.send({ type: "tool.result", payload: { jsonrpc: "2.0", id, ...body } });
    const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (method !== "tools/call") return reply({ error: { code: -32601, message: `unknown method ${method}` } });
    const text = (t: string) => ({ result: { content: [{ type: "text", text: t }] } });
    switch (p.name) {
      case "device.set_volume": {
        const level = p.arguments?.level;
        if (typeof level !== "number" || level < 0 || level > 100) {
          return reply({ error: { code: -32602, message: "level must be 0-100" } });
        }
        this.volume = Math.round(level);
        return reply(text(`volume set to ${this.volume}`));
      }
      case "device.get_status":
        return reply(text(JSON.stringify({ volume: this.volume, battery: null })));
      default:
        return reply({ error: { code: -32602, message: `unknown tool ${p.name}` } });
    }
  }
}
