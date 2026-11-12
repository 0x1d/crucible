// Structured logging: one line per event, `HOMUNCULUS_LOG=json` for JSON lines.

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = order[(process.env.HOMUNCULUS_LOG_LEVEL as Level) ?? "info"] ?? 1;
const json = process.env.HOMUNCULUS_LOG === "json";

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function fmt(v: unknown): string {
  return typeof v === "string" && !/\s/.test(v) ? v : JSON.stringify(v);
}

export function createLogger(base: Fields = {}): Logger {
  const write = (level: Level, event: string, fields: Fields = {}) => {
    if (order[level] < minLevel) return;
    const all = { ...base, ...fields };
    const ts = new Date().toISOString();
    const line = json
      ? JSON.stringify({ ts, level, event, ...all })
      : `${ts} ${level.toUpperCase().padEnd(5)} ${event}${Object.entries(all)
          .map(([k, v]) => ` ${k}=${fmt(v)}`)
          .join("")}`;
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
    child: (f) => createLogger({ ...base, ...f }),
  };
}
