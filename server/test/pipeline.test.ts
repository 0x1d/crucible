// Gateway + speech pipeline with fake providers: malformed uplink, device replacement, sandbox dirs.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import {
  encodeFrame,
  FrameFlag,
  FrameType,
  HDP_SUBPROTOCOL,
  parseServerMessage,
  type ServerMessage,
} from "@homunculus/protocol";
import WebSocket from "ws";
import { startGateway, type Gateway } from "../src/gateway/server.js";
import { createPipeline, deviceDirName, type Pipeline } from "../src/orchestrator/pipeline.js";
import { OpusFramer } from "../src/speech/audio.js";
import { captureLog, FakeBackend, FakeStt, FakeTts, fakeVad, until } from "./fakes.js";

let gw: Gateway;
let pipeline: Pipeline;
const backend = new FakeBackend();
const stt = new FakeStt();
const tts = new FakeTts();
const sandboxRoot = `${tmpdir()}/homunculus-test-sandbox`;

before(async () => {
  pipeline = createPipeline({
    persona: {
      id: "test",
      name: "Test",
      language: "en",
      wakeWord: "computer",
      tts: { provider: "fake", voice: "v" },
      emotionalRange: [],
      personality: "Test persona.",
    },
    stt,
    tts,
    vad: fakeVad,
    backend,
    sandboxRoot,
    log: captureLog(),
  });
  gw = await startGateway({
    host: "127.0.0.1",
    port: 0,
    deviceTokens: ["secret"],
    config: { captions: true, language: "en" },
    onConnection: (c) => pipeline.attach(c),
    log: captureLog(),
  });
});
after(async () => {
  await gw.close();
  await pipeline.close();
});

const hello = (resume?: string) => ({
  type: "hello",
  version: 1,
  device: { model: "sim", firmware: "0.0.0" },
  capabilities: {
    audio: {
      input: { format: "opus", sample_rate: 16000, channels: 1, frame_ms: 60 },
      output: { formats: ["opus"], sample_rates: [24000] },
    },
  },
  ...(resume ? { resume: { session_id: resume } } : {}),
});

class Client {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  closeCode: number | undefined;

  constructor(deviceId: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${gw.port}/hdp`, HDP_SUBPROTOCOL, {
      headers: { Authorization: "Bearer secret", "X-Device-Id": deviceId },
    });
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const r = parseServerMessage(data.toString());
      assert.ok(r.ok, data.toString());
      this.messages.push(r.message);
    });
    this.ws.on("close", (code) => (this.closeCode = code));
  }

  async ready(resume?: string): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.send(JSON.stringify(hello(resume)));
    const h = await this.waitFor((m) => m.type === "hello");
    await this.waitFor((m) => m.type === "avatar" && m.state === "idle");
    return h.type === "hello" ? h.session_id : "";
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  waitFor(pred: (m: ServerMessage) => boolean, from = 0, timeoutMs = 3000): Promise<ServerMessage> {
    return until(() => this.messages.slice(from).find(pred), timeoutMs, "server message");
  }
}

test("malformed uplink frames are reported, not fatal; the turn still completes", async () => {
  stt.finals = ["hello"];
  backend.scripts = [[{ type: "text.delta", text: "Hello back." }, { type: "done" }]];
  const c = new Client("dev-malformed");
  await c.ready();
  c.send({ type: "listen", state: "start", mode: "manual", trigger: "button" });
  const enc = new OpusFramer(16000);
  const frame = (seq: number, payload: Uint8Array, flags = 0) =>
    c.ws.send(encodeFrame({ type: FrameType.OpusUplink, flags, streamId: 9, seq, payload }));
  const tone = new Int16Array(960).map((_, i) => Math.round(8000 * Math.sin(i / 3)));
  frame(0, enc.push(tone)[0] as Uint8Array, FrameFlag.First);
  c.ws.send(Uint8Array.of(1, 2, 3)); // shorter than the header
  frame(1, new Uint8Array(4500)); // oversized payload
  frame(2, Uint8Array.from({ length: 40 }, (_, i) => (i * 37) & 0xff)); // not valid Opus
  frame(3, new Uint8Array(0)); // empty payload
  frame(4, enc.push(tone)[0] as Uint8Array);
  c.send({ type: "listen", state: "stop" });
  await c.waitFor((m) => m.type === "tts" && m.state === "stop");
  await c.waitFor((m) => m.type === "agent.status" && m.phase === "done");
  const errors = c.messages.filter((m) => m.type === "error");
  assert.ok(errors.length >= 2, JSON.stringify(errors));
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  assert.ok(tts.texts.includes("Hello back."));
  c.ws.close();
});

test("a reconnecting device replaces its old connection and resumes the agent session", async () => {
  const before = backend.sessions.length;
  const a = new Client("dev-replace");
  const hdp = await a.ready();
  await until(() => backend.sessions.length === before + 1);
  const b = new Client("dev-replace");
  await b.ready(hdp);
  await until(() => a.closeCode !== undefined, 3000, "old socket closed");
  assert.equal(a.closeCode, 4000);
  await until(() => backend.sessions.length === before + 2, 3000, "new session");
  const [old, neu] = backend.sessions.slice(before);
  assert.equal(old?.closed, true);
  assert.equal(backend.resumes.at(-1), old?.sessionId);
  assert.equal(neu?.ctx.cwd, `${sandboxRoot}/${deviceDirName("dev-replace")}`);
  b.ws.close();
  await until(() => neu?.closed, 3000, "session closed on disconnect");
});

test("deviceDirName is filesystem-safe and collision-free", () => {
  assert.match(deviceDirName("aa:bb:cc:dd:ee:ff"), /^aa_bb_cc_dd_ee_ff-[0-9a-f]{8}$/);
  for (const id of ["../../etc", "a/b", ".", "..", "", "x".repeat(300), "naïve id"]) {
    const d = deviceDirName(id);
    assert.match(d, /^[A-Za-z0-9_-]{1,57}$/, d);
  }
  assert.notEqual(deviceDirName("a:b"), deviceDirName("a_b"));
});
