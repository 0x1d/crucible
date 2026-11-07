// HDP WebSocket endpoint (spec §4.1): upgrade, sub-protocol, bearer auth.
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { HDP_SUBPROTOCOL, type SessionConfig } from "@homunculus/protocol";
import { WebSocketServer } from "ws";
import type { Logger } from "../log.js";
import { DeviceConnection, type DeviceIdentity } from "./connection.js";

export interface GatewayOptions {
  host?: string;
  port: number;
  path?: string;
  tls?: { cert: string | Buffer; key: string | Buffer };
  /** Accepted device bearer tokens (pairing replaces this in Phase 3). */
  deviceTokens: string[];
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
  const sessions = new SessionTable();
  const log = opts.log.child({ component: "gateway" });

  const server = opts.tls ? createHttpsServer(opts.tls) : createHttpServer();
  server.on("request", (_req, res) => {
    res.writeHead(404).end();
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
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const d = digest(token);
    if (!token || !tokens.some((t) => timingSafeEqual(t, d))) {
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
