import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  decodeFrame,
  encodeFrame,
  FrameFlag,
  FrameType,
  HDP_SUBPROTOCOL,
  parseServerMessage,
  type AudioFrame,
  type ServerMessage,
} from "@homunculus/protocol";
import WebSocket from "ws";
import { startGateway, type Gateway } from "../src/gateway/server.js";
import { createLogger } from "../src/log.js";
import { attachLoopback } from "../src/orchestrator/loopback.js";

let gw: Gateway;
const url = () => `ws://127.0.0.1:${gw.port}/hdp`;

before(async () => {
  gw = await startGateway({
    host: "127.0.0.1",
    port: 0,
    deviceTokens: ["secret"],
    config: { captions: true, language: "en" },
    helloTimeoutMs: 300,
    onConnection: attachLoopback,
    log: createLogger({ test: true }),
  });
});
after(() => gw.close());

const hello = (extra: Record<string, unknown> = {}) => ({
  type: "hello",
  version: 1,
  device: { model: "sim", firmware: "0.0.0" },
  capabilities: {
    audio: {
      input: { format: "opus", sample_rate: 16000, channels: 1, frame_ms: 60 },
      output: { formats: ["opus"], sample_rates: [16000, 24000] },
    },
  },
  ...extra,
});

class Client {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly frames: AudioFrame[] = [];
  private waiters: Array<() => void> = [];

  constructor(headers: Record<string, string> = {}, protocol = HDP_SUBPROTOCOL) {
    this.ws = new WebSocket(url(), protocol, {
      headers: { Authorization: "Bearer secret", "X-Device-Id": "aa:bb:cc:dd:ee:ff", ...headers },
    });
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) this.frames.push(decodeFrame(new Uint8Array(data as Buffer)));
      else {
        const r = parseServerMessage(data.toString());
        assert.ok(r.ok, `server sent invalid message: ${data.toString()}`);
        this.messages.push(r.message);
      }
      for (const w of this.waiters.splice(0)) w();
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  async waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs?: number): Promise<T>;
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    for (;;) {
      for (; seen < this.messages.length; seen++) {
        const m = this.messages[seen] as ServerMessage;
        if (pred(m)) return m;
      }
      if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(this.messages)}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  closed(): Promise<number> {
    return new Promise((resolve) => this.ws.once("close", (code) => resolve(code)));
  }
}

const upgradeStatus = (c: Client) =>
  new Promise<number>((resolve) => c.ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)));

test("rejects a wrong token with 401", async () => {
  assert.equal(await upgradeStatus(new Client({ Authorization: "Bearer nope" })), 401);
});

test("rejects a missing sub-protocol with 400", async () => {
  assert.equal(await upgradeStatus(new Client({}, "other")), 400);
});

test("hello handshake negotiates 24 kHz downlink and resumes sessions", async () => {
  const c = new Client();
  await c.open();
  c.send(hello());
  const h = await c.waitFor((m) => m.type === "hello");
  assert.equal(h.type === "hello" && h.audio.output.sample_rate, 24000);
  await c.waitFor((m) => m.type === "avatar" && m.state === "idle");
  const sessionId = h.type === "hello" ? h.session_id : "";
  c.ws.close();

  const c2 = new Client();
  await c2.open();
  c2.send(hello({ resume: { session_id: sessionId } }));
  const h2 = await c2.waitFor((m) => m.type === "hello");
  assert.equal(h2.type === "hello" && h2.session_id, sessionId);
  c2.ws.close();
});

test("rejects unknown HDP major", async () => {
  const c = new Client();
  await c.open();
  const closed = c.closed();
  c.send({ ...hello(), version: 2 });
  const e = await c.waitFor((m) => m.type === "error");
  assert.equal(e.type === "error" && e.code, "unsupported_version");
  assert.equal(await closed, 1008);
});

test("closes when no hello arrives", async () => {
  const c = new Client();
  await c.open();
  assert.equal(await c.closed(), 1008);
  assert.ok(c.messages.some((m) => m.type === "error" && m.code === "hello_required"));
});

test("ignores unknown types and reports invalid messages without closing", async () => {
  const c = new Client();
  await c.open();
  c.send(hello());
  await c.waitFor((m) => m.type === "hello");
  c.send({ type: "telemetry", rssi: -60 });
  c.send({ type: "listen", state: "pause" });
  const e = await c.waitFor((m) => m.type === "error");
  assert.equal(e.type === "error" && e.code, "bad_message");
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  c.ws.close();
});

test("loopback turn echoes uplink frames as paced downlink", async () => {
  const c = new Client();
  await c.open();
  c.send(hello());
  await c.waitFor((m) => m.type === "hello");
  c.send({ type: "listen", state: "start", mode: "auto", trigger: "touch" });
  const n = 8;
  for (let seq = 0; seq < n; seq++) {
    const flags = (seq === 0 ? FrameFlag.First : 0) | (seq === n - 1 ? FrameFlag.Last : 0);
    c.ws.send(encodeFrame({ type: FrameType.OpusUplink, flags, streamId: 5, seq, payload: Uint8Array.of(seq, 0xaa) }));
  }
  await c.waitFor((m) => m.type === "listen" && m.state === "stop");
  const stt = await c.waitFor((m) => m.type === "stt");
  assert.equal(stt.type === "stt" && stt.final, true);
  const t0 = performance.now();
  await c.waitFor((m) => m.type === "tts" && m.state === "segment_start");
  await c.waitFor((m) => m.type === "tts" && m.state === "stop");
  const elapsed = performance.now() - t0;
  assert.equal(c.frames.length, n);
  assert.deepEqual(
    c.frames.map((f) => [f.type, f.seq, f.payload[0]]),
    Array.from({ length: n }, (_, i) => [FrameType.OpusDownlink, i, i]),
  );
  assert.equal(c.frames[0]?.flags, FrameFlag.First);
  assert.equal(c.frames[n - 1]?.flags, FrameFlag.Last);
  // 8 frames, 3 prebuffered: last frame due at (8 - 1 - 3) * 60 = 240 ms.
  assert.ok(elapsed >= 200 && elapsed < 600, `paced over ${elapsed.toFixed(0)} ms`);
  c.ws.close();
});

test("abort stops loopback playback", async () => {
  const c = new Client();
  await c.open();
  c.send(hello());
  await c.waitFor((m) => m.type === "hello");
  c.send({ type: "listen", state: "start", mode: "manual", trigger: "button" });
  for (let seq = 0; seq < 50; seq++) {
    c.ws.send(encodeFrame({ type: FrameType.OpusUplink, flags: 0, streamId: 1, seq, payload: Uint8Array.of(1) }));
  }
  c.send({ type: "listen", state: "stop" });
  await c.waitFor((m) => m.type === "tts" && m.state === "segment_start");
  c.send({ type: "abort", reason: "barge_in" });
  await c.waitFor((m) => m.type === "tts" && m.state === "stop");
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(c.frames.length < 50, `got ${c.frames.length} frames`);
  assert.ok(!c.messages.some((m) => m.type === "tts" && m.state === "segment_end"));
  c.ws.close();
});
