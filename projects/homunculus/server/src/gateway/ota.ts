// Firmware images for device OTA (spec §3.6): GET /ota/{model}/firmware.bin, bearer auth.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../log.js";

const OTA_PATH = /^\/ota\/([A-Za-z0-9_-]{1,64})\/firmware\.bin$/;

/**
 * Serves `${dir}/${model}.bin`. Returns false when the request path is not an OTA path.
 * `authorized` checks the bearer token of the request.
 */
export async function handleOtaRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  authorized: (req: IncomingMessage) => boolean,
  log: Logger,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://x");
  const m = OTA_PATH.exec(url.pathname);
  if (!m) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return true;
  }
  if (!authorized(req)) {
    log.warn("ota_rejected", { why: "token", remote: req.socket.remoteAddress });
    res.writeHead(401).end();
    return true;
  }
  const model = m[1]!;
  const file = join(dir, `${model}.bin`);
  const st = await stat(file).catch(() => undefined);
  if (!st?.isFile()) {
    res.writeHead(404).end();
    return true;
  }
  log.info("ota_image", { model, bytes: st.size, method: req.method, remote: req.socket.remoteAddress });
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": st.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  // A version check closes the connection after the image header: pipeline() closes the file then.
  await pipeline(createReadStream(file), res).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ERR_STREAM_PREMATURE_CLOSE") log.warn("ota_read_failed", { model, error: String(e) });
  });
  return true;
}
