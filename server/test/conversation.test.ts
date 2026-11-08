// Conversation FSM (spec §5.2) with fake STT/TTS/VAD/agent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FrameFlag, type ServerMessage } from "@homunculus/protocol";
import { Conversation, type CompletedTurn, type ConversationDeps, type ConversationTimeouts } from "../src/orchestrator/conversation.js";
import { FakeBackend, FakeLink, FakeStt, FakeTts, fakeVad, sleep, until, Uplink, type Step } from "./fakes.js";

interface Setup {
  finals?: Array<string | null>;
  scripts?: Step[][];
  timeouts?: Partial<ConversationTimeouts>;
  fillerAfterMs?: number;
  interruptMs?: number;
  onTurn?: ConversationDeps["onTurn"];
  quietTool?: ConversationDeps["quietTool"];
  turnContext?: ConversationDeps["turnContext"];
}

function setup(o: Setup = {}) {
  const link = new FakeLink();
  const stt = new FakeStt();
  stt.finals = o.finals ?? [];
  const tts = new FakeTts();
  const backend = new FakeBackend();
  backend.scripts = o.scripts ?? [];
  backend.interruptMs = o.interruptMs ?? 0;
  const conv = new Conversation(link, {
    stt,
    tts,
    vad: fakeVad,
    voice: "test",
    language: "en",
    openAgent: (resumeSessionId) => backend.openSession({ systemPrompt: "", resumeSessionId }),
    fillerAfterMs: o.fillerAfterMs ?? 0,
    ...(o.onTurn ? { onTurn: o.onTurn } : {}),
    ...(o.quietTool ? { quietTool: o.quietTool } : {}),
    ...(o.turnContext ? { turnContext: o.turnContext } : {}),
    playedTimeoutMs: 200,
    timeouts: { uplinkGapMs: 1000, ...o.timeouts },
  });
  let stream = 0;
  /** Push-to-talk utterance: listen start, frames, listen stop. */
  const ask = (frames = 5) => {
    link.message({ type: "listen", state: "start", mode: "manual", trigger: "button" });
    new Uplink(link, ++stream).send(frames);
    link.message({ type: "listen", state: "stop" });
  };
  const listen = (mode: "auto" | "manual" = "auto") => {
    link.message({ type: "listen", state: "start", mode, trigger: "touch" });
    return new Uplink(link, ++stream);
  };
  /** Waits for avatar idle sent after message index `from`. */
  const idle = (from: number, timeoutMs = 3000) =>
    link.waitFor((m) => m.type === "avatar" && m.state === "idle", timeoutMs, from);
  return { link, stt, tts, backend, conv, ask, listen, idle };
}

const text = (t: string): Step => ({ type: "text.delta", text: t });
const done: Step = { type: "done" };
const turnLog = (link: FakeLink) => link.log.entries.filter((e) => e.event === "turn").map((e) => e.fields);
const isMsg = (type: string, state?: string) => (m: ServerMessage) =>
  m.type === type && (state === undefined || (m as { state?: string; phase?: string }).state === state || (m as { phase?: string }).phase === state);

test("empty transcript returns to idle without an agent turn", async () => {
  const t = setup({ finals: [""] });
  const from = t.link.sent.length;
  t.ask();
  await t.idle(from + 1);
  assert.equal(t.conv.state, "idle");
  assert.deepEqual(t.link.avatar(), ["idle", "listening", "thinking", "idle"]);
  assert.ok(t.link.sent.some((m) => m.type === "stt" && m.final && m.text === ""));
  await until(() => t.backend.sessions.length === 1);
  assert.equal(t.backend.inputs.length, 0);
});

test("normal turn: transcript → agent → segments → tts stop → idle", async () => {
  const t = setup({ finals: ["hello"], scripts: [[text("Hi there. "), text("How are you today?"), done]] });
  t.ask();
  await t.idle(2);
  assert.equal(t.conv.state, "idle");
  assert.deepEqual(t.backend.inputs, [{ kind: "utterance", text: "hello", heardSoFar: undefined }]);
  assert.deepEqual(t.tts.texts, ["Hi there.", "How are you today?"]);
  assert.deepEqual(t.link.types(), [
    "avatar:idle",
    "avatar:listening",
    "avatar:thinking",
    "stt",
    "agent.status:thinking",
    "tts:start",
    "avatar:speaking",
    "tts:segment_start",
    "tts:segment_end",
    "tts:segment_start",
    "tts:segment_end",
    "tts:stop",
    "agent.status:done",
    "avatar:idle",
  ]);
  // 2 frames per segment; First/Last flags per segment stream.
  assert.equal(t.link.frames.length, 4);
  assert.deepEqual(
    t.link.frames.map((f) => f.flags),
    [FrameFlag.First, FrameFlag.Last, FrameFlag.First, FrameFlag.Last],
  );
  const log = turnLog(t.link).at(-1);
  assert.ok(log && typeof log.t_first_downlink === "number" && typeof log.t_tts_first_chunk === "number");
});

test("quiet tools do not trigger the filler", async () => {
  const t = setup({
    finals: ["q"],
    fillerAfterMs: 1,
    quietTool: (n) => n.startsWith("mcp__memory__"),
    scripts: [[{ wait: 20 }, { type: "tool.start", name: "mcp__memory__search" }, { wait: 20 }, text("Answer."), done]],
  });
  t.ask();
  await t.idle(2);
  assert.deepEqual(t.tts.texts, ["Answer."]);
  await t.conv.close();
});

test("onTurn reports completed and interrupted turns (memory finalize)", async () => {
  const turns: CompletedTurn[] = [];
  const t = setup({
    finals: ["first", "second"],
    scripts: [[{ wait: 2000 }, text("Too late."), done], [text("Second answer."), done]],
    onTurn: (x) => turns.push(x),
  });
  t.ask();
  await until(() => t.conv.state === "running");
  t.ask();
  await until(() => turns.length === 2);
  assert.deepEqual(
    turns.map(({ text: q, reply, heard, tools }) => ({ q, reply, heard, tools })),
    [
      { q: "first", reply: "", heard: "", tools: [] },
      { q: "second", reply: "Second answer.", heard: undefined, tools: [] },
    ],
  );
  assert.ok(turns.every((x) => !Number.isNaN(Date.parse(x.at))));
});

test("turnContext is sent with the utterance; slow or failing lookups are skipped", async () => {
  const seen: string[] = [];
  const t = setup({
    finals: ["coffee?", "slow", "broken"],
    scripts: [[text("Oat."), done], [text("Ok."), done], [text("Ok."), done]],
    turnContext: async (q) => {
      seen.push(q);
      if (q === "slow") await sleep(2000);
      if (q === "broken") throw new Error("down");
      return q === "coffee?" ? "Relevant memory context:\n  oat milk" : undefined;
    },
  });
  for (let i = 0; i < 3; i++) {
    const from = t.link.sent.length;
    t.ask();
    await t.idle(from + 1, 4000);
  }
  assert.deepEqual(seen, ["coffee?", "slow", "broken"]);
  assert.deepEqual(t.backend.inputs, [
    { kind: "utterance", text: "coffee?", heardSoFar: undefined, context: "Relevant memory context:\n  oat milk" },
    { kind: "utterance", text: "slow", heardSoFar: undefined },
    { kind: "utterance", text: "broken", heardSoFar: undefined },
  ]);
  await t.conv.close();
});

test("barge-in while listening cancels the first utterance", async () => {
  const t = setup({ finals: ["first", "second"] });
  const up = t.listen("manual");
  up.send(3);
  t.ask();
  await t.idle(3);
  assert.equal(t.stt.streams[0]?.cancelled, true);
  assert.deepEqual(
    t.backend.inputs.map((i) => i.kind === "utterance" && i.text),
    ["second"],
  );
});

test("barge-in while running interrupts the agent; next turn gets heardSoFar ''", async () => {
  const t = setup({
    finals: ["first", "second"],
    scripts: [[{ wait: 2000 }, text("Too late."), done], [text("Second answer."), done]],
  });
  t.ask();
  await until(() => t.conv.state === "running");
  t.ask();
  const from = t.link.sent.length;
  await t.idle(from);
  const [s] = t.backend.sessions;
  assert.equal(s?.interrupts, 1);
  assert.deepEqual(t.backend.inputs[1], { kind: "utterance", text: "second", heardSoFar: "" });
  assert.deepEqual(t.tts.texts, ["Second answer."]);
});

test("barge-in while speaking: tts stop, heardSoFar = played segments + the one playing", async () => {
  const t = setup({
    finals: ["story", "stop"],
    scripts: [[text("One. Two. Three. Four. Five. Six. "), { wait: 2000 }, text("Seven."), done], [text("Fine."), done]],
  });
  t.tts.chunks = 6; // 360 ms per segment
  t.ask();
  await t.link.waitFor(isMsg("tts", "segment_end"));
  await until(() => t.link.sent.filter(isMsg("tts", "segment_start")).length >= 2, 3000, "second segment");
  await sleep(30); // tts.played of segment 1
  const before = t.link.frames.length;
  t.ask();
  const stopIdx = t.link.sent.findIndex(isMsg("tts", "stop"));
  assert.ok(stopIdx > 0, "tts stop on barge-in");
  await t.idle(stopIdx);
  const input = t.backend.inputs[1];
  assert.ok(input?.kind === "utterance");
  assert.equal(input.heardSoFar, "One. Two.");
  // No frames of the interrupted answer after barge-in (only the new answer's).
  const after = t.link.frames.slice(before);
  assert.ok(after.length <= 6 + 1, `frames after barge-in: ${after.length}`);
});

test("heardSoFar is cleared when the barge-in utterance yields no turn", async () => {
  const t = setup({
    finals: ["story", "", "next"],
    scripts: [[text("One. Two. Three. "), { wait: 2000 }, done], [text("Ok."), done]],
  });
  t.tts.chunks = 6;
  t.ask();
  await t.link.waitFor(isMsg("tts", "segment_start"));
  t.ask(); // barge-in, empty transcript
  await t.idle(t.link.sent.length);
  const from = t.link.sent.length;
  t.ask();
  await t.idle(from + 1);
  const input = t.backend.inputs.at(-1);
  assert.ok(input?.kind === "utterance");
  assert.equal(input.text, "next");
  assert.equal(input.heardSoFar, undefined);
});

test("abort while speaking stops playback and returns to idle", async () => {
  const t = setup({ finals: ["talk"], scripts: [[text("One. Two. Three. Four. Five."), done]] });
  t.tts.chunks = 6;
  t.ask();
  await t.link.waitFor(isMsg("tts", "segment_start"));
  const from = t.link.sent.length;
  t.link.message({ type: "abort", reason: "user_cancel" });
  assert.equal(t.conv.state, "idle");
  assert.ok(t.link.sent.slice(from).some(isMsg("tts", "stop")));
  const n = t.link.frames.length;
  await sleep(300);
  assert.equal(t.link.frames.length, n, "no frames after abort");
});

test("disconnect mid-turn closes the agent session and sends nothing more", async () => {
  const t = setup({ finals: ["hi"], scripts: [[{ wait: 300 }, text("Hello there."), done]] });
  t.ask();
  await until(() => t.conv.state === "running");
  t.link.emit("close", 1006, "");
  const n = t.link.sent.length;
  const id = await t.conv.close();
  assert.equal(id, "sess-1");
  assert.equal(t.backend.sessions[0]?.closed, true);
  await sleep(400);
  assert.equal(t.link.sent.length, n);
  assert.equal(t.link.frames.length, 0);
});

test("agent error: partial sentence, apology, idle; session reopened with resume", async () => {
  const t = setup({
    finals: ["q", "again"],
    scripts: [[text("Let me check"), { type: "error", message: "error_during_execution", retryable: false }], [text("Fine now."), done]],
  });
  t.ask();
  await t.idle(2);
  assert.deepEqual(t.tts.texts, ["Let me check", "Sorry, something went wrong on my end."]);
  assert.ok(t.link.avatar().includes("error"));
  assert.ok(t.link.sent.some((m) => m.type === "agent.status" && m.phase === "error"));
  assert.equal(t.conv.state, "idle");
  await until(() => t.backend.sessions.length === 2, 3000, "reopen");
  assert.deepEqual(t.backend.resumes, [undefined, "sess-1"]);
  assert.equal(t.backend.sessions[0]?.closed, true);
  const from = t.link.sent.length;
  t.ask();
  await t.idle(from + 1);
  assert.equal(t.backend.sessions[1]?.inputs[0]?.kind === "utterance" && t.backend.sessions[1].inputs[0].text, "again");
});

test("dead agent process: reopen resumes once, then starts fresh", async () => {
  const t = setup({ finals: ["a", "b"] });
  t.backend.scripts = [[{ throw: "spawn failed" }], [{ throw: "spawn failed" }]];
  t.ask();
  await t.idle(2);
  await until(() => t.backend.sessions.length === 2, 3000, "first reopen");
  const from = t.link.sent.length;
  t.ask();
  await t.idle(from + 1);
  await until(() => t.backend.sessions.length === 3, 3000, "second reopen");
  assert.deepEqual(t.backend.resumes, [undefined, "sess-1", undefined]);
});

test("turn watchdog: hung agent → apology → idle; session replaced", async () => {
  const t = setup({ finals: ["q"], scripts: [[{ hang: true }]], timeouts: { agentIdleMs: 150 } });
  t.ask();
  await t.idle(2);
  assert.deepEqual(t.tts.texts, ["Sorry, something went wrong on my end."]);
  const log = turnLog(t.link).at(-1);
  assert.match(String(log?.error), /agent: no progress for 150 ms/);
  await until(() => t.backend.sessions.length === 2, 3000, "reopen");
  assert.equal(t.backend.sessions[0]?.closed, true);
});

test("STT watchdog: no final transcript → apology → idle", async () => {
  const t = setup({ finals: [null], timeouts: { sttFinalMs: 100 } });
  t.ask();
  await t.idle(2);
  assert.equal(t.stt.streams[0]?.cancelled, true);
  assert.deepEqual(t.tts.texts, ["Sorry, something went wrong on my end."]);
  assert.equal(t.backend.inputs.length, 0);
});

test("speech watchdog: hung TTS ends the turn", async () => {
  const t = setup({ finals: ["q"], scripts: [[text("Stuck sentence."), done]], timeouts: { speechIdleMs: 150 } });
  t.tts.hang.add("Stuck sentence.");
  t.ask();
  await t.idle(2);
  assert.ok(t.link.log.entries.some((e) => e.event === "speech_stalled"));
  assert.ok(t.link.avatar().includes("error"));
});

test("auto mode: uplink stops without Last flag → wall-clock endpoint", async () => {
  const t = setup({ finals: ["hi"], timeouts: { uplinkGapMs: 150 } });
  const up = t.listen("auto");
  up.send(8); // speech, then the device goes silent
  await until(() => t.stt.streams[0]?.ended, 2000, "endpoint");
  await t.idle(2);
  assert.ok(t.link.log.entries.some((e) => e.event === "uplink_timeout" && e.fields.reason === "uplink_gap"));
  assert.equal(t.backend.inputs.length, 1);
});

test("auto mode: no frames at all → no speech → idle", async () => {
  const t = setup({ timeouts: { uplinkGapMs: 100 } });
  t.listen("auto");
  await t.idle(2);
  assert.ok(t.link.sent.some((m) => m.type === "listen" && m.state === "stop"));
  assert.equal(t.stt.streams[0]?.cancelled, true);
});

test("auto mode: VAD endpoint after hangover", async () => {
  const t = setup({ finals: ["hi"] });
  const up = t.listen("auto");
  up.send(6, 14); // 360 ms speech, 840 ms silence > 600 ms hangover
  await t.idle(2);
  assert.equal(t.backend.inputs.length, 1);
  const utt = t.link.log.entries.find((e) => e.event === "utterance");
  assert.equal(utt?.fields.reason, "vad");
});

test("uplink frames of another stream or before the stream start are dropped", async () => {
  const t = setup({ finals: ["x"] });
  t.link.message({ type: "listen", state: "start", mode: "manual", trigger: "button" });
  const stale = new Uplink(t.link, 7);
  stale.send(1); // seq 0 → latches stream 7
  const other = new Uplink(t.link, 8);
  other.send(3); // dropped (other stream)
  stale.send(2);
  t.link.message({ type: "listen", state: "stop" });
  await t.idle(2);
  assert.equal(t.stt.streams[0]?.samples, 3 * 960);
  assert.equal(t.link.log.entries.find((e) => e.event === "utterance")?.fields.dropped, 3);

  // Mid-stream frames (no First flag, seq > 0) before any stream start are dropped too.
  const t2 = setup({ finals: ["y"] });
  t2.link.message({ type: "listen", state: "start", mode: "manual", trigger: "button" });
  const up = new Uplink(t2.link, 3);
  up.send(1);
  t2.stt.streams[0]!.samples = 0;
  const late = new Uplink(t2.link, 2);
  late.frame(true, 0); // seq 0 of stream 2 after stream 3 latched: dropped
  t2.link.message({ type: "listen", state: "stop" });
  await t2.idle(2);
  assert.equal(t2.stt.streams[0]?.samples, 0);
});

test("barge-in during a slow interrupt waits for the old stream instead of failing", async () => {
  const t = setup({
    finals: ["first", "second"],
    scripts: [[{ wait: 3000 }, done], [text("Second."), done]],
    interruptMs: 400,
  });
  t.ask();
  await until(() => t.conv.state === "running");
  t.ask();
  const from = t.link.sent.length;
  await t.idle(from);
  assert.deepEqual(t.tts.texts, ["Second."]);
  assert.equal(t.backend.sessions.length, 1);
  assert.ok(!t.link.log.entries.some((e) => e.event === "agent_error"));
});

test("stuck interrupt: session reopened after interruptWaitMs, next turn still answered", async () => {
  const t = setup({
    finals: ["first", "second"],
    scripts: [[{ wait: 5000 }, done], [text("Second."), done]],
    interruptMs: Infinity,
    timeouts: { interruptWaitMs: 200 },
  });
  t.ask();
  await until(() => t.conv.state === "running");
  t.ask();
  const from = t.link.sent.length;
  await t.idle(from);
  assert.deepEqual(t.tts.texts, ["Second."]);
  assert.equal(t.backend.sessions.length, 2);
  assert.deepEqual(t.backend.resumes, [undefined, "sess-1"]);
});

test("filler does not count as the answer's first sentence; avatar working after speech", async () => {
  const t = setup({
    finals: ["weather"],
    fillerAfterMs: 1,
    scripts: [
      [
        { wait: 20 },
        { type: "tool.start", name: "WebSearch" },
        { wait: 300 },
        { type: "tool.end", name: "x", ok: true },
        text("Sunny tomorrow."),
        { wait: 50 },
        { type: "tool.start", name: "WebFetch" },
        { wait: 400 },
        text(" Fourteen degrees."),
        done,
      ],
    ],
  });
  t.ask();
  await t.idle(2);
  assert.deepEqual(t.tts.texts, ["One moment.", "Sunny tomorrow.", "Fourteen degrees."]);
  const log = turnLog(t.link).at(-1) as Record<string, number>;
  assert.ok(log.t_filler !== undefined && log.t_first_audio !== undefined);
  assert.ok(log.t_first_sentence! > log.t_filler!, "first_sentence is the answer, after the filler");
  assert.ok(log.t_first_downlink! > log.t_first_audio!, "first_downlink is the answer segment");
  // working (tool 1) → speaking (filler) → … → working (tool 2 after speech drained) → speaking
  const av = t.link.avatar();
  const i = av.indexOf("speaking");
  assert.ok(av.indexOf("working") < i);
  assert.ok(av.slice(i).includes("working"), `avatar ${av.join(",")}`);
  assert.equal(av.at(-1), "idle");
});

test("announcement then tool: avatar speaking → working while the tool runs → speaking", async () => {
  const t = setup({
    finals: ["weather"],
    scripts: [[text("Let me look that up."), { type: "tool.start", name: "WebSearch" }, { wait: 500 }, text("Sunny."), done]],
  });
  t.ask();
  await t.idle(2);
  assert.deepEqual(t.tts.texts, ["Let me look that up.", "Sunny."]);
  const av = t.link.avatar().slice(3); // after idle, listening, thinking
  assert.deepEqual(av, ["working", "speaking", "working", "speaking", "idle"]);
});
