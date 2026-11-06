import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { repoRoot } from "../../core/elixir-bridge.ts";
import { HOST_TOOL_NAMES } from "../../core/protocol.ts";
import { saveMaxContextTokens } from "../../hosts/cursor/bot/lib/host-flags.ts";
import type { PermissionHandler } from "../../hosts/acp/connection.ts";
import type { DiscoveredAgent } from "../../hosts/acp/discovery.ts";
import { AcpClientAdapter, AcpEventMapper, AcpSessionIndex, mergeReplayedUserChunks } from "./acp.ts";
import type { HostEvent } from "./types.ts";

function nodeAgent(id: string, script: string): DiscoveredAgent {
  return {
    id,
    label: id,
    source: "registry",
    spawn: {
      command: process.execPath,
      args: ["--experimental-strip-types", "--no-warnings", path.join(repoRoot, script)],
    },
  };
}

const fixture = nodeAgent("fixture", "hosts/acp/mcp-over-acp-agent.ts");

function adapterFor(t: TestContext, agent = fixture, requestPermission?: PermissionHandler) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acp-adapter-")));
  const adapter = new AcpClientAdapter(agent, {
    repoRoot: base,
    stateRoot: path.join(base, ".agent-serve"),
    requestPermission,
  });
  t.after(() => adapter.close());
  return { adapter, base };
}

async function collect(
  adapter: AcpClientAdapter,
  prompt: string,
  signal = new AbortController().signal,
): Promise<HostEvent[]> {
  const events: HostEvent[] = [];
  for await (const event of adapter.send(prompt, signal)) events.push(event);
  return events;
}

const toolResult = (events: HostEvent[]) => {
  const result = events.find((e) => e.type === "tool_result");
  assert.ok(result?.type === "tool_result");
  return result;
};

test("mapper reports a tool call and its result once", () => {
  const mapper = new AcpEventMapper();
  assert.deepEqual(
    mapper.map({ sessionUpdate: "tool_call", toolCallId: "a", title: "Read", status: "pending", rawInput: { p: 1 } }),
    [{ type: "tool", id: "a", name: "Read", input: { p: 1 } }],
  );
  assert.deepEqual(mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "a", status: "in_progress" }), []);
  const done = {
    sessionUpdate: "tool_call_update" as const,
    toolCallId: "a",
    status: "failed" as const,
    rawOutput: { why: "no" },
  };
  assert.deepEqual(mapper.map(done), [{ type: "tool_result", id: "a", ok: false, output: '{"why":"no"}' }]);
  assert.deepEqual(mapper.map(done), []);
});

test("mapper starts a tool from an update it has not seen", () => {
  const events = new AcpEventMapper().map({
    sessionUpdate: "tool_call_update",
    toolCallId: "b",
    title: "Write",
    status: "completed",
    content: [{ type: "diff", path: "/a", newText: "x" }],
  });
  assert.deepEqual(events, [
    { type: "tool", id: "b", name: "Write", input: undefined },
    { type: "tool_result", id: "b", ok: true, output: "/a\nx" },
  ]);
});

test("mapper counts only USD cost and surfaces error notices", () => {
  const mapper = new AcpEventMapper();
  assert.deepEqual(
    mapper.map({ sessionUpdate: "usage_update", used: 1, size: 2, cost: { amount: 3, currency: "EUR" } }),
    [{ type: "usage", contextTokens: 1, contextWindow: 2 }],
  );
  assert.deepEqual(mapper.map({ sessionUpdate: "notice", severity: "error", title: "Bad", description: "worse" }), [
    { type: "error", message: "Bad: worse" },
  ]);
  assert.deepEqual(mapper.map({ sessionUpdate: "notice", severity: "info", title: "Fine" }), []);
});

test("replayed user chunks merge into one message", () => {
  assert.deepEqual(
    mergeReplayedUserChunks([
      { type: "user", text: "a" },
      { type: "user", text: "b" },
      { type: "text", delta: "c" },
      { type: "user", text: "d" },
    ]),
    [
      { type: "user", text: "ab" },
      { type: "text", delta: "c" },
      { type: "user", text: "d" },
    ],
  );
});

test("session index keeps the first prompt as the title", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acp-index-")), "a/sessions.json");
  const index = new AcpSessionIndex(file);
  index.touch("s", "/cwd", "first", new Date(1));
  index.touch("s", "/cwd", "second", new Date(2));
  assert.deepEqual(index.all(), [
    { id: "s", cwd: "/cwd", title: "first", updatedAt: new Date(2).toISOString() },
  ]);
});

test("a turn streams events and finishes with done", async (t) => {
  const { adapter } = adapterFor(t);
  const events = await collect(adapter, "hello");
  assert.deepEqual(
    events.map((e) => e.type),
    ["reasoning", "tool", "tool_result", "text", "usage", "done"],
  );
  assert.equal(adapter.notice, undefined);
  assert.deepEqual(events.at(-1), { type: "done", sessionId: adapter.sessionId });
  assert.deepEqual(events.at(-2), { type: "usage", contextTokens: 1200, contextWindow: 8000, costUsd: 0.25 });
  const [summary] = await adapter.listSessions();
  assert.equal(summary?.id, adapter.sessionId);
  assert.equal(summary?.title, "hello");
});

test("MCP-over-ACP lists the codex tools", async (t) => {
  const { adapter } = adapterFor(t);
  const { output } = toolResult(await collect(adapter, "tools"));
  const names = (JSON.parse(output) as { result: { tools: { name: string }[] } }).result.tools.map((x) => x.name);
  for (const name of Object.values(HOST_TOOL_NAMES)) assert.ok(names.includes(name), name);
  assert.ok(names.includes("handoff"));
});

test("the session cwd is a harness directory, and fs stays inside the roots", async (t) => {
  const { adapter, base } = adapterFor(t);
  fs.writeFileSync(path.join(base, "inside.txt"), "inside");
  const inRepo = toolResult(await collect(adapter, `read ${path.join(base, "inside.txt")}`));
  assert.equal(inRepo.ok, true);
  assert.equal(inRepo.output, "inside");

  const outside = path.join(repoRoot, "package.json");
  const refused = toolResult(await collect(adapter, `read ${outside}`));
  assert.equal(refused.ok, false);
  assert.match(refused.output, /Invalid params/);

  const harnesses = fs.readdirSync(path.join(base, ".sessions"));
  assert.equal(harnesses.length, 1);
  const inHarness = path.join(base, ".sessions", harnesses[0] as string, "note.txt");
  assert.equal(toolResult(await collect(adapter, `write ${inHarness} hi`)).ok, true);
  assert.equal(fs.readFileSync(inHarness, "utf8"), "hi");
});

test("permission requests go to the handler", async (t) => {
  const { adapter } = adapterFor(t, fixture, async () => ({ outcome: "selected", optionId: "yes" }));
  assert.equal(toolResult(await collect(adapter, "ask")).output, "yes");
});

test("without a handler, permission requests are refused", async (t) => {
  const { adapter } = adapterFor(t);
  assert.equal(toolResult(await collect(adapter, "ask")).output, "no");
});

test("stopping a turn cancels it and keeps the session usable", async (t) => {
  const { adapter } = adapterFor(t);
  await adapter.openSession(undefined);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 200);
  const events = await collect(adapter, "hang", stop.signal);
  assert.deepEqual(events, []);
  assert.equal((await collect(adapter, "hello")).at(-1)?.type, "done");
});

test("stopping a turn answers a pending permission request as cancelled", async (t) => {
  const { adapter } = adapterFor(t, fixture, (_request, signal) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({ outcome: "cancelled" }), { once: true });
    }),
  );
  await adapter.openSession(undefined);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 200);
  assert.equal(toolResult(await collect(adapter, "ask", stop.signal)).output, "cancelled");
});

test("a turn stopped before it starts refuses permission without asking", async (t) => {
  let asked = false;
  const { adapter } = adapterFor(t, fixture, async () => {
    asked = true;
    return { outcome: "selected", optionId: "yes" };
  });
  await adapter.openSession(undefined);
  const stop = new AbortController();
  stop.abort();
  assert.equal(toolResult(await collect(adapter, "ask", stop.signal)).output, "cancelled");
  assert.equal(asked, false);
});

test("an agent that dies mid-turn reports an error and the next turn starts over", async (t) => {
  const { adapter } = adapterFor(t);
  const events = await collect(adapter, "die");
  assert.equal(events.at(-1)?.type, "error");
  const died = adapter.sessionId;
  // The fixture keeps sessions in memory, so the new process cannot load the old one.
  const next = await collect(adapter, "hello");
  assert.match((next[0] as { message: string }).message, /could not reload the session/);
  assert.equal(next.at(-1)?.type, "done");
  assert.notEqual(adapter.sessionId, died);
});

test("loading a session replays it on the same connection", async (t) => {
  const { adapter } = adapterFor(t);
  await collect(adapter, "hello");
  const id = adapter.sessionId as string;
  await adapter.openSession(undefined);
  assert.notEqual(adapter.sessionId, id);
  const replay = await adapter.openSession(id);
  assert.equal(adapter.sessionId, id);
  assert.deepEqual(replay, [
    { type: "user", text: "hello" },
    { type: "text", delta: "replayed hello" },
  ]);
});

test("a successful handoff forks the next prompt into a new seeded session", async (t) => {
  const { adapter, base } = adapterFor(t);
  fs.writeFileSync(path.join(base, "handoff.md"), "HANDOFF BODY");
  await collect(adapter, "echo Wrote handoff.md (12 bytes).");
  const oldId = adapter.sessionId;
  const events = await collect(adapter, "echo next");
  assert.notEqual(adapter.sessionId, oldId);
  assert.equal(events.at(-1)?.type, "done");
  const newest = (await adapter.listSessions()).find((x) => x.id === adapter.sessionId);
  assert.match(newest?.title ?? "", /HANDOFF BODY/);
  assert.match(newest?.title ?? "", /echo next/);
});

test("over the context budget, a turn without a handoff stops with an error", async (t) => {
  const { adapter, base } = adapterFor(t);
  saveMaxContextTokens(1000, path.join(base, ".agent-serve"), "acp");
  await collect(adapter, "hello");
  const id = adapter.sessionId;
  const events = await collect(adapter, "hello again");
  assert.match((events.at(-1) as { message: string }).message, /Handoff did not complete/);
  assert.equal(adapter.sessionId, id);
});

test("an agent without MCP-over-ACP skips the handoff route over budget", async (t) => {
  const { adapter, base } = adapterFor(t, nodeAgent("plain", "hosts/acp/agent.ts"));
  saveMaxContextTokens(1, path.join(base, ".agent-serve"), "acp");
  await collect(adapter, "hello");
  assert.equal((await collect(adapter, "hello again")).at(-1)?.type, "done");
});

test("models and effort come from session config options", async (t) => {
  const { adapter } = adapterFor(t);
  assert.deepEqual(await adapter.listModels(), [
    { id: "small", label: "Small", efforts: ["low", "high"] },
    { id: "large", label: "Large", efforts: ["low", "high"] },
  ]);
  assert.equal(adapter.model, "small");
  adapter.setModel("large", "high");
  assert.equal(adapter.model, "large");
  assert.equal((await collect(adapter, "hello")).at(-1)?.type, "done");
});

test("an agent without MCP-over-ACP runs chat-only with a notice", async (t) => {
  const { adapter } = adapterFor(t, nodeAgent("plain", "hosts/acp/agent.ts"));
  await adapter.openSession(undefined);
  assert.match(adapter.notice ?? "", /codex tools are unavailable/);
  const id = adapter.sessionId as string;
  await collect(adapter, "hello");
  await assert.rejects(adapter.openSession(id), /cannot load sessions/);
});

test("a missing binary fails the session without crashing", async (t) => {
  const { adapter } = adapterFor(t, {
    id: "missing",
    label: "missing",
    source: "user",
    spawn: { command: "alchemist-no-such-agent" },
  });
  await assert.rejects(adapter.openSession(undefined), /cannot start alchemist-no-such-agent/);
});
