import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { defaultStateRoot } from "./context-improvements.ts";

export function logToolResultSize(
  toolName: string,
  output: unknown,
  enabled: boolean,
): void {
  if (!enabled) return;
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  const root = defaultStateRoot();
  mkdirSync(root, { recursive: true });
  const line = `${new Date().toISOString()}\t${toolName}\t${bytes}\n`;
  appendFileSync(path.join(root, "context-tool-sizes.log"), line, "utf8");
}
