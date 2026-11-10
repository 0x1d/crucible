// Paired devices and pairing requests (spec 07 §7.3, spec 03 §3.5).
// Registry `<dataDir>/devices.json`: per-device bearer tokens stored as SHA-256; admin key
// `<dataDir>/admin-key` (mode 0600) authorizes approvals (phone page, CLI).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DeviceRecord {
  name: string;
  model: string;
  token_sha256: string;
  paired_at: string;
}

interface RegistryFile {
  version: 1;
  /** Stable server id, advertised over mDNS (TXT `id`) so devices find the same server again. */
  server_id: string;
  devices: Record<string, DeviceRecord>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();
const sameHash = (hex: string, token: string) => {
  const a = Buffer.from(hex, "hex");
  const b = sha256(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Crockford base32 without I, L, O, U: readable on a phone keyboard.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** 12 characters (60 bits) as `xxxx-xxxx-xxxx`. */
export function newAdminKey(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b & 31]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Normalises typed input: case, spaces and dashes do not matter. */
const normKey = (k: string) => k.toLowerCase().replace(/[\s-]/g, "");

export class AdminKey {
  private readonly hash: Buffer;
  constructor(key: string) {
    this.hash = sha256(normKey(key));
  }
  /** `<dataDir>/admin-key`, created on first use; `override` (env) wins. */
  static load(dataDir: string, override?: string): AdminKey {
    if (override) return new AdminKey(override);
    const file = join(dataDir, "admin-key");
    if (!existsSync(file)) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, `${newAdminKey()}\n`, { mode: 0o600 });
    }
    return new AdminKey(readFileSync(file, "utf8").trim());
  }
  check(key: string | undefined): boolean {
    return key !== undefined && key !== "" && timingSafeEqual(sha256(normKey(key)), this.hash);
  }
}

export class DeviceRegistry {
  private data: RegistryFile;

  constructor(private readonly file: string) {
    this.data = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as RegistryFile)
      : { version: 1, server_id: randomBytes(6).toString("hex"), devices: {} };
    if (!existsSync(file)) this.save();
  }

  get serverId(): string {
    return this.data.server_id;
  }

  verify(deviceId: string, token: string): boolean {
    const d = this.data.devices[deviceId];
    return d !== undefined && token !== "" && sameHash(d.token_sha256, token);
  }

  /** Issues a new token for `deviceId` (replaces an earlier pairing). */
  pair(deviceId: string, model: string, name: string): string {
    const token = randomBytes(32).toString("base64url");
    this.data.devices[deviceId] = {
      name,
      model,
      token_sha256: sha256(token).toString("hex"),
      paired_at: new Date().toISOString(),
    };
    this.save();
    return token;
  }

  revoke(deviceId: string): boolean {
    if (!this.data.devices[deviceId]) return false;
    delete this.data.devices[deviceId];
    this.save();
    return true;
  }

  rename(deviceId: string, name: string): boolean {
    const d = this.data.devices[deviceId];
    if (!d) return false;
    d.name = name;
    this.save();
    return true;
  }

  get(deviceId: string): DeviceRecord | undefined {
    return this.data.devices[deviceId];
  }

  list(): Array<{ device_id: string; name: string; model: string; paired_at: string }> {
    return Object.entries(this.data.devices).map(([device_id, d]) => ({
      device_id,
      name: d.name,
      model: d.model,
      paired_at: d.paired_at,
    }));
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export type PairingState = "pending" | "approved" | "rejected" | "expired";

export interface PairingRequest {
  code: string;
  deviceId: string;
  model: string;
  firmware: string;
  remote: string;
  createdAt: number;
  expiresAt: number;
  state: PairingState;
  name?: string;
  /** Set on approval; handed to the device once, then the request is dropped. */
  token?: string;
}

export interface PairingOptions {
  ttlMs?: number;
  maxPending?: number;
  now?: () => number;
}

/** In-memory pairing requests: a 6-digit code shown on the device, a secret only the device knows. */
export class Pairings {
  private readonly byCode = new Map<string, PairingRequest & { secret: Buffer }>();
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;

  constructor(
    private readonly registry: DeviceRegistry,
    opts: PairingOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxPending = opts.maxPending ?? 16;
    this.now = opts.now ?? Date.now;
  }

  /** A new request replaces an open one of the same device. */
  request(deviceId: string, model: string, firmware: string, remote: string): { code: string; secret: string; expiresInS: number } {
    this.expire();
    for (const [code, r] of this.byCode) if (r.deviceId === deviceId) this.byCode.delete(code);
    while (this.byCode.size >= this.maxPending) this.byCode.delete(this.byCode.keys().next().value!);
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    while (this.byCode.has(code));
    const secret = randomBytes(24).toString("base64url");
    const t = this.now();
    this.byCode.set(code, {
      code,
      deviceId,
      model,
      firmware,
      remote,
      createdAt: t,
      expiresAt: t + this.ttlMs,
      state: "pending",
      secret: sha256(secret),
    });
    return { code, secret, expiresInS: Math.round(this.ttlMs / 1000) };
  }

  /** Device poll. An approved request returns the token once and is then removed. */
  status(code: string, secret: string): { state: PairingState; token?: string; name?: string } | undefined {
    this.expire();
    const r = this.byCode.get(code);
    if (!r || !timingSafeEqual(sha256(secret), r.secret)) return undefined;
    if (r.state === "approved" || r.state === "rejected") this.byCode.delete(code);
    return { state: r.state, token: r.token, name: r.name };
  }

  get(code: string): PairingRequest | undefined {
    this.expire();
    const r = this.byCode.get(code);
    return r && strip(r);
  }

  pending(): PairingRequest[] {
    this.expire();
    return [...this.byCode.values()].filter((r) => r.state === "pending").map(strip);
  }

  approve(code: string, name?: string): PairingRequest | undefined {
    this.expire();
    const r = this.byCode.get(code);
    if (!r || r.state !== "pending") return undefined;
    r.name = name?.trim() || this.registry.get(r.deviceId)?.name || r.model || r.deviceId;
    r.token = this.registry.pair(r.deviceId, r.model, r.name);
    r.state = "approved";
    return strip(r);
  }

  reject(code: string): boolean {
    this.expire();
    const r = this.byCode.get(code);
    if (!r || r.state !== "pending") return false;
    r.state = "rejected";
    return true;
  }

  private expire(): void {
    const t = this.now();
    for (const [code, r] of this.byCode) {
      if (t > r.expiresAt) this.byCode.delete(code);
    }
  }
}

function strip(r: PairingRequest & { secret?: Buffer }): PairingRequest {
  const { secret: _s, token: _t, ...rest } = r;
  return rest;
}
