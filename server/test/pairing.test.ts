import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { HDP_SUBPROTOCOL } from "@homunculus/protocol";
import WebSocket from "ws";
import { AdminKey, DeviceRegistry, Pairings } from "../src/admin/devices.js";
import { startGateway, type Gateway } from "../src/gateway/server.js";
import { createLogger } from "../src/log.js";
import { attachLoopback } from "../src/orchestrator/loopback.js";

const KEY = "abcd-efgh-jkmn";
const dir = mkdtempSync(join(tmpdir(), "hom-pair-"));
const registry = new DeviceRegistry(join(dir, "devices.json"));
let gw: Gateway;
const base = () => `http://127.0.0.1:${gw.port}`;

before(async () => {
  gw = await startGateway({
    host: "127.0.0.1",
    port: 0,
    deviceTokens: [],
    loopbackTokens: ["dev"],
    devices: { registry, pairings: new Pairings(registry), adminKey: new AdminKey(KEY) },
    config: { captions: true, language: "en" },
    helloTimeoutMs: 2000,
    onConnection: attachLoopback,
    log: createLogger({ test: true }),
  });
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
  return gw.close();
});

const requestPairing = async (deviceId: string) => {
  const res = await fetch(`${base()}/pair`, {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, model: "sim", firmware: "1.2.3" }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as { code: string; secret: string; approve_url: string; poll_ms: number };
};

const status = async (code: string, secret: string) => {
  const res = await fetch(`${base()}/pair/status?code=${code}`, { headers: { "X-Pair-Secret": secret } });
  return { status: res.status, body: (await res.json()) as { state: string; token?: string; name?: string } };
};

const admin = (method: string, path: string, body?: unknown, key = KEY) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
    body: body ? JSON.stringify(body) : undefined,
  });

/** Resolves with the HTTP status of a rejected upgrade, or 101 once open (then closes). */
const upgrade = (token: string, deviceId: string) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/hdp`, HDP_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId },
    });
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("open", () => {
      ws.close();
      resolve(101);
    });
  });

test("device pairs through the admin API and connects with its token", async () => {
  const p = await requestPairing("11:22:33:44:55:66");
  assert.match(p.code, /^\d{6}$/);
  assert.equal(p.approve_url, `${base()}/p/${p.code}`);
  assert.equal((await status(p.code, p.secret)).body.state, "pending");
  assert.equal((await status(p.code, "wrong")).status, 404);

  assert.equal((await admin("GET", "/admin/pairings", undefined, "nope")).status, 401);
  const pending = (await (await admin("GET", "/admin/pairings")).json()) as Array<{ code: string }>;
  assert.ok(pending.some((r) => r.code === p.code));
  assert.equal((await admin("POST", `/admin/pairings/${p.code}/approve`, { name: "kitchen" })).status, 200);

  const s = await status(p.code, p.secret);
  assert.equal(s.body.state, "approved");
  assert.equal(s.body.name, "kitchen");
  assert.ok(s.body.token);
  assert.equal((await status(p.code, p.secret)).status, 404, "token is handed out once");

  assert.equal(await upgrade(s.body.token!, "11:22:33:44:55:66"), 101);
  assert.equal(await upgrade(s.body.token!, "aa:aa:aa:aa:aa:aa"), 401, "token is bound to its device id");
  const list = (await (await admin("GET", "/admin/devices")).json()) as Array<{ device_id: string; name: string }>;
  assert.deepEqual(
    list.map((d) => [d.device_id, d.name]),
    [["11:22:33:44:55:66", "kitchen"]],
  );
});

test("phone page asks for the admin key once, then approves", async () => {
  const p = await requestPairing("22:22:22:22:22:22");
  const page = await fetch(p.approve_url);
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.match(text, new RegExp(`${p.code.slice(0, 3)} ${p.code.slice(3)}`));
  assert.match(text, /name="key"/);

  const post = (form: Record<string, string>, cookie?: string) =>
    fetch(p.approve_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
      body: new URLSearchParams(form).toString(),
    });
  assert.equal((await post({ action: "approve", key: "wrong-key" })).status, 403);
  const ok = await post({ action: "approve", key: "ABCD EFGH JKMN", name: "desk" });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("hom_admin="));
  assert.equal((await status(p.code, p.secret)).body.name, "desk");

  // The cookie replaces the key field on the next request.
  const q = await requestPairing("33:33:33:33:33:33");
  const again = await (await fetch(q.approve_url, { headers: { Cookie: cookie! } })).text();
  assert.doesNotMatch(again, /name="key"/);
  assert.equal((await post({ action: "reject" }, cookie)).status, 404, "the first request is gone");
});

test("revoking closes the connection and invalidates the token", async () => {
  const p = await requestPairing("44:44:44:44:44:44");
  await admin("POST", `/admin/pairings/${p.code}/approve`, {});
  const token = (await status(p.code, p.secret)).body.token!;
  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/hdp`, HDP_SUBPROTOCOL, {
    headers: { Authorization: `Bearer ${token}`, "X-Device-Id": "44:44:44:44:44:44" },
  });
  await new Promise((r) => ws.once("open", r));
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
  assert.equal((await admin("DELETE", "/admin/devices/44%3A44%3A44%3A44%3A44%3A44")).status, 200);
  assert.equal(await closed, 4001);
  assert.equal(await upgrade(token, "44:44:44:44:44:44"), 401);
});

test("loopback token works from localhost only paths", async () => {
  assert.equal(await upgrade("dev", "55:55:55:55:55:55"), 101);
});

test("pairing requests expire and a new request replaces the old one", () => {
  let now = 0;
  const reg = new DeviceRegistry(join(dir, "expire.json"));
  const p = new Pairings(reg, { ttlMs: 1000, now: () => now });
  const a = p.request("d1", "m", "f", "r");
  const b = p.request("d1", "m", "f", "r");
  assert.equal(p.status(a.code, a.secret), undefined);
  assert.equal(p.status(b.code, b.secret)?.state, "pending");
  now = 1001;
  assert.equal(p.status(b.code, b.secret), undefined);
  assert.equal(p.approve(b.code), undefined);
});

test("registry persists tokens as hashes", () => {
  const file = join(dir, "persist.json");
  const token = new DeviceRegistry(file).pair("d1", "m", "n");
  const reloaded = new DeviceRegistry(file);
  assert.ok(reloaded.verify("d1", token));
  assert.ok(!reloaded.verify("d1", "x"));
  assert.doesNotMatch(JSON.stringify(reloaded.list()), new RegExp(token));
});
