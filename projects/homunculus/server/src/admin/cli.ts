// Device admin CLI (spec 03 §3.5): talks to the running server's admin API with the admin key.
//   pnpm devices key                      print the admin key (phone pairing page)
//   pnpm devices pending                  open pairing requests
//   pnpm devices approve <code> [name]    pair the device showing <code>
//   pnpm devices reject <code>
//   pnpm devices list                     paired devices
//   pnpm devices rename <device-id> <name>
//   pnpm devices revoke <device-id>       delete the token; a connected device is closed and pairs again
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir as resolveDataDir } from "../data-dir.js";

const env = process.env;
const dataDir = resolveDataDir(env);
const tls = Boolean(env.HOMUNCULUS_TLS_CERT && env.HOMUNCULUS_TLS_KEY);
const base = env.HOMUNCULUS_ADMIN_URL ?? `${tls ? "https" : "http"}://127.0.0.1:${env.HOMUNCULUS_PORT ?? 8443}`;
const [cmd, ...args] = process.argv.slice(2);

function adminKey(): string {
  if (env.HOMUNCULUS_ADMIN_KEY) return env.HOMUNCULUS_ADMIN_KEY;
  try {
    return readFileSync(join(dataDir, "admin-key"), "utf8").trim();
  } catch {
    throw new Error(`no admin key in ${dataDir}/admin-key (start the server once)`);
  }
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminKey()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e: unknown) => {
    throw new Error(`server not reachable at ${base}: ${String(e)}`);
  });
  const out = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(`${res.status}: ${out.error ?? "failed"}`);
  return out;
}

const usage = "usage: pnpm devices <key|pending|approve <code> [name]|reject <code>|list|rename <id> <name>|revoke <id>>";
const enc = encodeURIComponent;

switch (cmd) {
  case "key":
    console.log(adminKey());
    break;
  case "pending":
    console.table(await call("GET", "/admin/pairings"), ["code", "deviceId", "model", "firmware", "remote"]);
    break;
  case "approve": {
    const [code, ...name] = args;
    if (!code) throw new Error(usage);
    console.log(await call("POST", `/admin/pairings/${enc(code)}/approve`, { name: name.join(" ") }));
    break;
  }
  case "reject":
    if (!args[0]) throw new Error(usage);
    await call("POST", `/admin/pairings/${enc(args[0])}/reject`, {});
    break;
  case "list":
    console.table(await call("GET", "/admin/devices"));
    break;
  case "rename": {
    const [id, ...name] = args;
    if (!id || name.length === 0) throw new Error(usage);
    await call("PATCH", `/admin/devices/${enc(id)}`, { name: name.join(" ") });
    break;
  }
  case "revoke":
    if (!args[0]) throw new Error(usage);
    await call("DELETE", `/admin/devices/${enc(args[0])}`);
    break;
  default:
    console.error(usage);
    process.exit(2);
}
