// HDP WebSocket endpoint (spec §4.1): upgrade, sub-protocol, bearer auth; OTA images (spec §3.6);
// pairing and admin API (spec 03 §3.5).
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { HDP_SUBPROTOCOL, type SessionConfig } from "@homunculus/protocol";
import { WebSocketServer } from "ws";
import type { AdminKey, DeviceRegistry, Pairings } from "../admin/devices.js";
import type { Logger } from "../log.js";
import { DeviceConnection, type DeviceIdentity } from "./connection.js";
import { handleOtaRequest } from "./ota.js";
import { createPairingHandler } from "./pairing.js";

export interface GatewayOptions {
  host?: string;
  port: number;
  path?: string;
  tls?: { cert: string | Buffer; key: string | Buffer };
  /** Shared bearer tokens accepted for any device id (HOMUNCULUS_DEVICE_TOKENS). */
  deviceTokens: string[];
  /** Shared tokens accepted only from loopback addresses (development token `dev` for the simulator). */
  loopbackTokens?: string[];
  /** Paired devices (per-device tokens) and pairing; unset: shared tokens only, no pairing endpoints. */
  devices?: { registry: DeviceRegistry; pairings: Pairings; adminKey: AdminKey };
  /** Directory with OTA images `<model>.bin` served at /ota/<model>/firmware.bin; unset: no OTA. */
  otaDir?: string;
  config: SessionConfig;
  downlinkRates?: number[];
  helloTimeoutMs?: number;
  idleTimeoutMs?: number;
  onConnection(conn: DeviceConnection): void;
  log: Logger;
}

export interface Gateway {
  server: Server;
  /** Bound port (useful with port 0). */
  port: number;
  close(): Promise<void>;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** In-memory session ids; resume is accepted for the same device id (spec §4.1). */
class SessionTable {
  private bySession = new Map<string, string>();

  resolve(identity: DeviceIdentity, resume: string | undefined): string {
    if (resume && this.bySession.get(resume) === identity.deviceId) return resume;
    const id = `s_${randomBytes(12).toString("base64url")}`;
    this.bySession.set(id, identity.deviceId);
    return id;
  }
}

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const path = opts.path ?? "/hdp";
  const tokens = opts.deviceTokens.map(digest);
  const loopbackTokens = (opts.loopbackTokens ?? []).map(digest);
  const sessions = new SessionTable();
  const log = opts.log.child({ component: "gateway" });
  const live = new Map<string, Set<DeviceConnection>>();

  const isLoopback = (a: string | undefined) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
  const authorized = (req: IncomingMessage) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token === "") return false;
    const d = digest(token);
    if (tokens.some((t) => timingSafeEqual(t, d))) return true;
    if (isLoopback(req.socket.remoteAddress) && loopbackTokens.some((t) => timingSafeEqual(t, d))) return true;
    const deviceId = String(req.headers["x-device-id"] ?? "");
    return opts.devices?.registry.verify(deviceId, token) ?? false;
  };

  const pairing = opts.devices
    ? createPairingHandler({
        ...opts.devices,
        tls: opts.tls !== undefined,
        log: opts.log,
        onRevoked: (id) => {
          for (const c of live.get(id) ?? []) c.close(4001, "revoked");
        },
      })
    : undefined;

  const server = opts.tls ? createHttpsServer(opts.tls) : createHttpServer();
  server.on("request", (req, res) => {
    const ota = opts.otaDir;
    const route = async () =>
      (pairing ? await pairing(req, res) : false) || (ota ? await handleOtaRequest(req, res, ota, authorized, log) : false);
    void route().then(
      (handled) => {
        if (!handled) res.writeHead(404).end();
      },
      (e: unknown) => {
        log.warn("request_failed", { error: String(e) });
        if (!res.headersSent) res.writeHead(500);
        res.end();
      },
    );
  });

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(HDP_SUBPROTOCOL) ? HDP_SUBPROTOCOL : false),
  });

  const reject = (socket: Duplex, status: number, text: string, why: string, req: IncomingMessage) => {
    log.warn("upgrade_rejected", { status, why, remote: req.socket.remoteAddress });
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== path) return reject(socket, 404, "Not Found", "path", req);
    const protocols = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    if (!protocols.includes(HDP_SUBPROTOCOL)) return reject(socket, 400, "Bad Request", "subprotocol", req);
    if (!authorized(req)) {
      return reject(socket, 401, "Unauthorized", "token", req);
    }
    const deviceId = String(req.headers["x-device-id"] ?? "");
    if (!deviceId) return reject(socket, 400, "Bad Request", "x-device-id", req);
    const identity: DeviceIdentity = {
      deviceId,
      model: String(req.headers["x-device-model"] ?? ""),
      firmware: String(req.headers["x-firmware"] ?? ""),
    };
    wss.handleUpgrade(req, socket, head, (ws) => {
      log.info("connected", { device: deviceId, model: identity.model, remote: req.socket.remoteAddress });
      const conn = new DeviceConnection(
        ws,
        identity,
        {
          helloTimeoutMs: opts.helloTimeoutMs ?? 10_000,
          idleTimeoutMs: opts.idleTimeoutMs ?? 60_000,
          downlinkRates: opts.downlinkRates ?? [24000, 16000],
          config: opts.config,
          resolveSession: (id, resume) => sessions.resolve(id, resume),
        },
        opts.log,
      );
      const set = live.get(deviceId) ?? new Set();
      live.set(deviceId, set.add(conn));
      conn.on("close", () => {
        set.delete(conn);
        if (set.size === 0 && live.get(deviceId) === set) live.delete(deviceId);
      });
      opts.onConnection(conn);
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  log.info("listening", { url: `${opts.tls ? "wss" : "ws"}://${opts.host ?? "0.0.0.0"}:${port}${path}` });

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
