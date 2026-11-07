// One authenticated device connection after the WebSocket upgrade (spec §4.1, §4.2).
import { EventEmitter } from "node:events";
import {
  decodeFrame,
  encodeFrame,
  FrameError,
  FrameType,
  HDP_VERSION,
  parseDeviceMessage,
  type AudioFrame,
  type AudioStreamParams,
  type DeviceHello,
  type DeviceMessage,
  type ErrorCode,
  type ServerHello,
  type ServerMessage,
  type SessionConfig,
} from "@homunculus/protocol";
import type { WebSocket } from "ws";
import type { Logger } from "../log.js";

export interface DeviceIdentity {
  deviceId: string;
  model: string;
  firmware: string;
}

export interface ConnectionOptions {
  helloTimeoutMs: number;
  /** Close after this long without any frame, ping or pong from the device. */
  idleTimeoutMs: number;
  /** Downlink sample rates the server can produce, in preference order. */
  downlinkRates: number[];
  config: SessionConfig;
  /** Returns the session id to use: the resumed one if valid, else a new one. */
  resolveSession(identity: DeviceIdentity, resume: string | undefined): string;
}

type Events = {
  /** Handshake complete. */
  ready: [];
  message: [DeviceMessage];
  audio: [AudioFrame];
  close: [code: number, reason: string];
};

export class DeviceConnection extends EventEmitter<Events> {
  hello: DeviceHello | undefined;
  sessionId: string | undefined;
  downlink: AudioStreamParams | undefined;
  readonly log: Logger;
  private lastActivity = performance.now();
  private readonly helloTimer: NodeJS.Timeout;
  private readonly idleTimer: NodeJS.Timeout;

  constructor(
    private readonly ws: WebSocket,
    readonly identity: DeviceIdentity,
    private readonly opts: ConnectionOptions,
    log: Logger,
  ) {
    super();
    this.log = log.child({ device: identity.deviceId });
    this.helloTimer = setTimeout(() => this.fail("hello_required", "no hello received"), opts.helloTimeoutMs);
    this.idleTimer = setInterval(() => {
      if (performance.now() - this.lastActivity > opts.idleTimeoutMs) {
        this.log.warn("idle_timeout");
        ws.terminate();
      }
    }, Math.min(10_000, opts.idleTimeoutMs / 2));

    const touch = () => (this.lastActivity = performance.now());
    ws.on("ping", touch);
    ws.on("pong", touch);
    ws.on("message", (data, isBinary) => {
      touch();
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (isBinary) this.onBinary(buf);
      else this.onText(buf.toString("utf8"));
    });
    ws.on("close", (code, reason) => {
      clearTimeout(this.helloTimer);
      clearInterval(this.idleTimer);
      this.log.info("disconnected", { code, reason: reason.toString() });
      this.emit("close", code, reason.toString());
    });
    ws.on("error", (err) => this.log.warn("socket_error", { error: err.message }));
  }

  get ready(): boolean {
    return this.sessionId !== undefined;
  }

  send(msg: ServerMessage): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.log.debug("tx", { type: msg.type });
    this.ws.send(JSON.stringify(msg));
  }

  /** Sends one downlink frame immediately; use a Pacer for real-time pacing. */
  sendAudio(frame: Omit<AudioFrame, "type">): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(encodeFrame({ type: FrameType.OpusDownlink, ...frame }));
  }

  close(code = 1000, reason = ""): void {
    this.ws.close(code, reason);
  }

  private error(code: ErrorCode, message: string): void {
    this.log.warn("protocol_error", { code, message });
    this.send({ type: "error", code, message });
  }

  /** Sends an error and closes (policy violation). */
  private fail(code: ErrorCode, message: string): void {
    this.error(code, message);
    this.close(1008, code);
  }

  private onText(text: string): void {
    if (!this.ready) return this.onHandshake(text);
    const r = parseDeviceMessage(text);
    if (!r.ok) {
      if (r.kind === "unknown") this.log.debug("ignored_unknown_type", { type: r.type });
      else this.error("bad_message", r.error);
      return;
    }
    if (r.message.type === "hello") return this.error("bad_message", "duplicate hello");
    this.log.debug("rx", { type: r.message.type });
    this.emit("message", r.message);
  }

  private onHandshake(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.fail("bad_message", "malformed JSON");
    }
    const obj = raw as { type?: unknown; version?: unknown };
    if (obj?.type !== "hello") return this.fail("hello_required", "first message must be hello");
    // Version check precedes schema validation: other majors may have other shapes (§4.8).
    if (obj.version !== HDP_VERSION) {
      return this.fail("unsupported_version", `HDP major ${String(obj.version)} not supported`);
    }
    const r = parseDeviceMessage(raw);
    if (!r.ok || r.message.type !== "hello") {
      return this.fail("bad_message", r.ok ? "expected hello" : r.kind === "invalid" ? r.error : "expected hello");
    }
    const hello = r.message;
    const input = hello.capabilities.audio.input;
    if (input.format !== "opus" || input.sample_rate !== 16000 || input.channels !== 1 || input.frame_ms !== 60) {
      return this.fail("bad_message", "uplink must be opus 16000 Hz mono 60 ms");
    }
    const out = hello.capabilities.audio.output;
    const rate = out.formats.includes("opus")
      ? this.opts.downlinkRates.find((r) => out.sample_rates.includes(r))
      : undefined;
    if (rate === undefined) return this.fail("bad_message", "no supported downlink audio format");

    clearTimeout(this.helloTimer);
    this.hello = hello;
    this.downlink = { format: "opus", sample_rate: rate, channels: 1, frame_ms: 60 };
    this.sessionId = this.opts.resolveSession(this.identity, hello.resume?.session_id);
    const reply: ServerHello = {
      type: "hello",
      session_id: this.sessionId,
      audio: { output: this.downlink },
      config: this.opts.config,
    };
    this.send(reply);
    this.log.info("session_ready", {
      session: this.sessionId,
      resumed: hello.resume?.session_id === this.sessionId,
      model: hello.device.model,
      firmware: hello.device.firmware,
      downlink_hz: rate,
      tools: hello.tools?.length ?? 0,
    });
    this.emit("ready");
  }

  private onBinary(buf: Buffer): void {
    if (!this.ready) return this.fail("hello_required", "audio before hello");
    let frame: AudioFrame;
    try {
      frame = decodeFrame(buf);
    } catch (e) {
      if (e instanceof FrameError) return this.error("bad_message", e.message);
      throw e;
    }
    if (frame.type !== FrameType.OpusUplink) {
      return this.error("bad_message", `unexpected frame type ${frame.type} from device`);
    }
    this.emit("audio", frame);
  }
}
