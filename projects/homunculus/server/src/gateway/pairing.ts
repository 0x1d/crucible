// Pairing over HTTP (spec 03 §3.5, spec 07 §7.3).
//   POST /pair                      device: {device_id, model, firmware} -> code, secret, approve_url
//   GET  /pair/status?code=         device, header X-Pair-Secret -> state, token once approved
//   GET  /p/<code>, POST /p/<code>  phone page (QR on the device): approve / reject with the admin key
//   /admin/pairings, /admin/devices admin API (CLI), header Authorization: Bearer <admin key>
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminKey, DeviceRegistry, Pairings, PairingRequest } from "../admin/devices.js";
import type { Logger } from "../log.js";

export interface PairingContext {
  registry: DeviceRegistry;
  pairings: Pairings;
  adminKey: AdminKey;
  tls: boolean;
  log: Logger;
  /** Called after a device was revoked (its live connection is closed). */
  onRevoked?(deviceId: string): void;
}

const COOKIE = "hom_admin";
const MAX_BODY = 4096;
const POLL_MS = 2000;

/** Failed admin-key checks per minute before 429 (brute force over the LAN). */
class FailureLimit {
  private times: number[] = [];
  constructor(private readonly perMinute = 10) {}
  blocked(): boolean {
    const t = Date.now();
    this.times = this.times.filter((x) => t - x < 60_000);
    return this.times.length >= this.perMinute;
  }
  fail(): void {
    this.times.push(Date.now());
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

const parseJson = (s: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(s || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, "invalid JSON");
};

const str = (v: unknown, max = 64) => (typeof v === "string" ? v.slice(0, max) : "");

const cookieKey = (req: IncomingMessage) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === COOKIE)
    ?.slice(1)
    .join("=");
const decode = (s: string | undefined) => {
  try {
    return s === undefined ? undefined : decodeURIComponent(s);
  } catch {
    return undefined;
  }
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createPairingHandler(ctx: PairingContext) {
  const limit = new FailureLimit();
  const log = ctx.log.child({ component: "pairing" });

  const adminOk = (key: string | undefined): boolean | "blocked" => {
    if (limit.blocked()) return "blocked";
    if (ctx.adminKey.check(key)) return true;
    if (key) limit.fail();
    return false;
  };

  const approveUrl = (req: IncomingMessage, code: string) =>
    `${ctx.tls ? "https" : "http"}://${req.headers.host ?? "localhost"}/p/${code}`;

  async function device(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === "/pair" && req.method === "POST") {
      const b = parseJson(await readBody(req));
      const deviceId = str(b.device_id);
      if (!deviceId) throw new HttpError(400, "device_id required");
      const model = str(b.model);
      const remote = req.socket.remoteAddress ?? "";
      const r = ctx.pairings.request(deviceId, model, str(b.firmware), remote);
      log.info("pair_requested", { device: deviceId, model, code: r.code, remote });
      return json(res, 200, {
        code: r.code,
        secret: r.secret,
        approve_url: approveUrl(req, r.code),
        expires_in_s: r.expiresInS,
        poll_ms: POLL_MS,
      });
    }
    if (url.pathname === "/pair/status" && req.method === "GET") {
      const s = ctx.pairings.status(url.searchParams.get("code") ?? "", String(req.headers["x-pair-secret"] ?? ""));
      if (!s) return json(res, 404, { state: "expired" });
      if (s.state === "approved") log.info("pair_delivered", { name: s.name });
      return json(res, 200, s.token ? { state: s.state, token: s.token, name: s.name } : { state: s.state });
    }
    throw new HttpError(405, "method not allowed");
  }

  async function page(req: IncomingMessage, res: ServerResponse, code: string): Promise<void> {
    const r = ctx.pairings.get(code);
    let key = decode(cookieKey(req));
    let message = "";
    let setCookie: string | undefined;
    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const typed = form.get("key") ?? "";
      if (typed) key = typed;
      const ok = adminOk(key);
      if (ok === "blocked") message = "Too many wrong keys. Try again in a minute.";
      else if (!ok) message = "Wrong server key.";
      else if (!r || r.state !== "pending") message = "This pairing request has expired. A new code is on the device.";
      else {
        if (typed) {
          setCookie = `${COOKIE}=${encodeURIComponent(typed)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${ctx.tls ? "; Secure" : ""}`;
        }
        if (form.get("action") === "reject") {
          ctx.pairings.reject(code);
          log.info("pair_rejected", { device: r.deviceId, via: "page" });
          return html(res, 200, done("Rejected", `${r.model || "Device"} ${r.deviceId} was not paired.`), setCookie);
        }
        const a = ctx.pairings.approve(code, str(form.get("name"), 40));
        log.info("pair_approved", { device: r.deviceId, name: a?.name, via: "page" });
        return html(res, 200, done("Paired", `${a?.name ?? r.deviceId} is paired. It connects in a few seconds.`), setCookie);
      }
    } else if (!r || r.state !== "pending") {
      message = "This pairing request has expired. A new code is on the device.";
    }
    if (!r || r.state !== "pending") return html(res, 404, done("Not paired", message));
    const known = adminOk(key) === true;
    return html(res, message ? 403 : 200, form(r, code, known, message), setCookie);
  }

  async function admin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const auth = req.headers.authorization ?? "";
    const ok = adminOk(auth.startsWith("Bearer ") ? auth.slice(7) : undefined);
    if (ok === "blocked") throw new HttpError(429, "too many failed attempts");
    if (!ok) throw new HttpError(401, "admin key required");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); // admin, kind, id, verb
    const [, kind, id, verb] = parts;
    if (kind === "pairings" && !id && req.method === "GET") return json(res, 200, ctx.pairings.pending());
    if (kind === "pairings" && id && req.method === "POST" && verb === "approve") {
      const b = parseJson(await readBody(req));
      const a = ctx.pairings.approve(id, str(b.name, 40));
      if (!a) throw new HttpError(404, "no pending request with this code");
      log.info("pair_approved", { device: a.deviceId, name: a.name, via: "admin" });
      return json(res, 200, { device_id: a.deviceId, name: a.name });
    }
    if (kind === "pairings" && id && req.method === "POST" && verb === "reject") {
      if (!ctx.pairings.reject(id)) throw new HttpError(404, "no pending request with this code");
      log.info("pair_rejected", { code: id, via: "admin" });
      return json(res, 200, { ok: true });
    }
    if (kind === "devices" && !id && req.method === "GET") return json(res, 200, ctx.registry.list());
    if (kind === "devices" && id && req.method === "DELETE") {
      if (!ctx.registry.revoke(id)) throw new HttpError(404, "unknown device");
      log.info("device_revoked", { device: id });
      ctx.onRevoked?.(id);
      return json(res, 200, { ok: true });
    }
    if (kind === "devices" && id && req.method === "PATCH") {
      const name = str(parseJson(await readBody(req)).name, 40);
      if (!name) throw new HttpError(400, "name required");
      if (!ctx.registry.rename(id, name)) throw new HttpError(404, "unknown device");
      return json(res, 200, { ok: true });
    }
    throw new HttpError(404, "not found");
  }

  /** Returns false when the path is not a pairing / admin path. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const pageCode = /^\/p\/(\d{6})$/.exec(p)?.[1];
    if (p !== "/pair" && p !== "/pair/status" && !pageCode && !p.startsWith("/admin/")) return false;
    try {
      if (pageCode) {
        if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "method not allowed");
        await page(req, res, pageCode);
      } else if (p.startsWith("/admin/")) await admin(req, res, url);
      else await device(req, res, url);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      if (pageCode) html(res, e.status, done("Error", e.message));
      else json(res, e.status, { error: e.message });
    }
    return true;
  };
}

// ---- phone page -------------------------------------------------------------

function html(res: ServerResponse, status: number, body: string, setCookie?: string): void {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    "X-Frame-Options": "DENY",
  };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  res.writeHead(status, headers);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Homunculus pairing</title>
<style>
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6b6862;--card:#fff;--line:#dedbd4;--accent:#2f6f5e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--muted:#9c9890;--card:#211f1d;--line:#38352f;--accent:#6fc2a8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,sans-serif}
main{max-width:420px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0;word-break:break-all}
label{display:block;font-size:14px;color:var(--muted);margin:12px 0 4px}
input{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;font:inherit;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.msg{color:#b3261e;margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
</style></head><body><main>${body}</main></body></html>`);
}

function form(r: PairingRequest, code: string, known: boolean, message: string): string {
  const keyField = known
    ? ""
    : `<label for="key">Server key</label><input id="key" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" required>
<p class="muted">In <code>admin-key</code> in the server's data directory, or <code>make devices ARGS=key</code>. Asked once per phone.</p>`;
  return `<h1>Pair this device?</h1>
${message ? `<p class="msg">${esc(message)}</p>` : ""}
<div class="card"><dl>
<dt>Code</dt><dd><strong>${code.slice(0, 3)} ${code.slice(3)}</strong></dd>
<dt>Model</dt><dd>${esc(r.model || "unknown")}</dd>
<dt>Device</dt><dd>${esc(r.deviceId)}</dd>
<dt>Firmware</dt><dd>${esc(r.firmware || "unknown")}</dd>
</dl></div>
<p class="muted">Check that the code matches the one on the device screen.</p>
<form method="post" class="card">
<label for="name">Name (optional)</label><input id="name" name="name" maxlength="40" placeholder="e.g. kitchen">
${keyField}
<div class="row"><button name="action" value="reject">Reject</button><button class="primary" name="action" value="approve">Pair</button></div>
</form>`;
}

const done = (title: string, text: string) => `<h1>${esc(title)}</h1><div class="card">${esc(text)}</div>`;
