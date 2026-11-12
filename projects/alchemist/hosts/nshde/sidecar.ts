import http from "node:http";
import { pathToFileURL } from "node:url";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { runSession, type QueryFn, type SessionEvent, type SessionRequest } from "./session.ts";

/**
 * nshde agent sidecar: a Node process that runs Claude Agent SDK sessions
 * with the codex tools and streams them over SSE.
 *
 * One endpoint: `POST /sessions` with `{ prompt, sessionId?, agent? }`.
 * The response is `text/event-stream`; each event's name is its `type`
 * and its data is the JSON event (see `SessionEvent`).
 *
 * Configuration:
 * - `NSHDE_SIDECAR_HOST` (default `127.0.0.1`) and `NSHDE_SIDECAR_PORT` (default `43124`)
 * - `NSHDE_API_URL` (default `http://127.0.0.1:43123`): nshde base URL, passed to the BEAM for `nshde.component.*`
 * - `NSHDE_AGENT_MODEL`: optional model id
 */

const maxBody = 256 * 1024;

export interface SidecarDeps {
  query: QueryFn;
  baseOptions?: () => Options;
  model?: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseRequest(body: string): SessionRequest | string {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return "body must be JSON";
  }
  if (!value || typeof value !== "object") return "body must be an object";
  const { prompt, sessionId, agent } = value as Record<string, unknown>;
  if (typeof prompt !== "string" || !prompt.trim()) return "prompt required";
  if (sessionId !== undefined && typeof sessionId !== "string") return "sessionId must be a string";
  const role =
    agent && typeof agent === "object" && typeof (agent as { id?: unknown }).id === "string"
      ? (agent as SessionRequest["agent"])
      : undefined;
  return { prompt, ...(sessionId ? { sessionId } : {}), ...(role ? { agent: role } : {}) };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function writeEvent(res: http.ServerResponse, event: SessionEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function createSidecar(deps: SidecarDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://sidecar");
    if (url.pathname !== "/sessions") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    let request: SessionRequest | string;
    try {
      request = parseRequest(await readBody(req));
    } catch (error) {
      sendJson(res, 413, { error: error instanceof Error ? error.message : "bad request" });
      return;
    }
    if (typeof request === "string") {
      sendJson(res, 400, { error: request });
      return;
    }

    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abortController.abort();
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    for await (const event of runSession(request, { ...deps, abortController })) {
      if (abortController.signal.aborted) break;
      writeEvent(res, event);
    }
    res.end();
  });
}

function main(): void {
  // The bridge starts the BEAM with this process's environment, so NSHDE_API_URL reaches the codex entries.
  process.env.NSHDE_API_URL ??= "http://127.0.0.1:43123";
  const host = process.env.NSHDE_SIDECAR_HOST || "127.0.0.1";
  const port = Number(process.env.NSHDE_SIDECAR_PORT) || 43124;
  const server = createSidecar({
    query: query as QueryFn,
    model: process.env.NSHDE_AGENT_MODEL || undefined,
  });
  server.listen(port, host, () => {
    console.log(`nshde agent sidecar on http://${host}:${port}/sessions (nshde API ${process.env.NSHDE_API_URL})`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
