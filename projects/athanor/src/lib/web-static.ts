import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "text/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".nshc": "application/octet-stream",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function contentType(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME[filePath.slice(dot)] ?? "application/octet-stream";
}

/** Resolve packaged NSH web output (from `nsh package . --target web`). */
export function resolveWebRoot(): string | null {
  const configured = process.env.NSHDE_WEB_DIR?.trim();
  const candidates = [
    configured,
    join(import.meta.dir, "../../.nsh/out/nshde"),
    join(import.meta.dir, "../../public/web"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    const index = join(dir, "index.html");
    if (existsSync(index)) return dir;
  }
  return null;
}

/** Serve a file from the NSH web bundle, or null if not found / unsafe path. */
export function serveWebFile(webRoot: string, pathname: string): Response | null {
  let rel = pathname;
  if (rel === "/" || rel === "") rel = "/index.html";
  rel = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) return null;

  const filePath = join(webRoot, rel);
  if (!filePath.startsWith(webRoot)) return null;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;

  const file = Bun.file(filePath);
  return new Response(file, {
    headers: {
      "Content-Type": contentType(filePath),
      "Cache-Control": pathname.match(/\.[a-f0-9]{8,}\./) ? "public, max-age=31536000, immutable" : "public, max-age=0",
    },
  });
}
