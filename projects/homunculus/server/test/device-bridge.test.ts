// Device tool bridge: tool.call/tool.result, confirmations, policy (spec §5.6).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolCall } from "@homunculus/protocol";
import { DeviceBridge, agentToolName } from "../src/tools/device-bridge.js";
import { devicePolicy } from "../src/tools/policy.js";
import { FakeLink, until } from "./fakes.js";

const descriptors = [
  { name: "device.set_volume", description: "Speaker volume", inputSchema: { type: "object", properties: { level: { type: "number" } } } },
  { name: "device.open_garage", description: "Open the garage", inputSchema: { type: "object" } },
];

function setup(opts = {}) {
  const link = new FakeLink();
  const bridge = new DeviceBridge(link, () => descriptors, opts);
  const lastCall = () => link.sent.filter((m): m is ToolCall => m.type === "tool.call").at(-1);
  return { link, bridge, lastCall };
}

test("tool names and policy", () => {
  assert.equal(agentToolName("device.set_volume"), "set_volume");
  assert.equal(agentToolName("x.y z"), "x_y_z");
  const { bridge } = setup();
  assert.deepEqual(bridge.tools().map((t) => [t.name, t.policy]), [["set_volume", "allow"], ["open_garage", "ask"]]);
  assert.equal(devicePolicy("device.unknown"), "ask");
});

test("tool call round trip", async () => {
  const { link, bridge, lastCall } = setup();
  const p = bridge.call("device.set_volume", { level: 40 });
  const c = (await until(lastCall)).payload;
  assert.equal(c.method, "tools/call");
  assert.deepEqual(c.params, { name: "device.set_volume", arguments: { level: 40 } });
  link.message({ type: "tool.result", payload: { jsonrpc: "2.0", id: c.id, result: { content: [{ type: "text", text: "volume 40" }] } } });
  assert.deepEqual(await p, { ok: true, text: "volume 40" });
});

test("tool error, isError and timeout", async () => {
  const { link, bridge, lastCall } = setup({ toolTimeoutMs: 30 });
  const e = bridge.call("device.get_status", {});
  link.message({ type: "tool.result", payload: { jsonrpc: "2.0", id: (await until(lastCall)).payload.id, error: { code: -32601, message: "no such tool" } } });
  assert.deepEqual(await e, { ok: false, text: "no such tool" });
  const t = await bridge.call("device.get_status", {});
  assert.equal(t.ok, false);
  assert.match(t.text, /did not answer/);
});

test("confirmation approve, deny, timeout, abort", async () => {
  const { link, bridge } = setup({ confirmTimeoutMs: 40 });
  const changes: boolean[] = [];
  bridge.onConfirmChange = (w) => changes.push(w);
  const req = () => link.sent.filter((m) => m.type === "confirm.request").at(-1) as Extract<(typeof link.sent)[number], { type: "confirm.request" }>;

  const a = bridge.confirm({ tool: "open_garage", title: "Open garage", detail: "{}" });
  link.message({ type: "confirm.result", request_id: (await until(req)).request_id, approved: true });
  assert.equal(await a, true);

  const d = bridge.confirm({ tool: "open_garage", title: "Open garage", detail: "{}" });
  await until(() => changes.length === 3);
  link.message({ type: "confirm.result", request_id: req().request_id, approved: false });
  assert.equal(await d, false);

  assert.equal(await bridge.confirm({ tool: "x", title: "t", detail: "d" }), false); // timeout

  const ac = new AbortController();
  const b = bridge.confirm({ tool: "x", title: "t", detail: "d", timeoutMs: 5000 }, ac.signal);
  ac.abort();
  assert.equal(await b, false);
  assert.deepEqual(changes, [true, false, true, false, true, false, true, false]);
  assert.equal(req().timeout_ms, 5000);
});

test("close fails open calls and denies confirmations", async () => {
  const { bridge } = setup();
  const c = bridge.call("device.set_volume", {});
  const f = bridge.confirm({ tool: "x", title: "t", detail: "d" });
  bridge.close();
  assert.deepEqual(await c, { ok: false, text: "device disconnected" });
  assert.equal(await f, false);
  assert.equal(await bridge.confirm({ tool: "x", title: "t", detail: "d" }), false);
});
