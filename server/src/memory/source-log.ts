// Source log (spec 10 §10.1): verbatim turns per session, append-only markdown.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TurnRecord {
  at: string;
  user: string;
  assistant: string;
  tools: string[];
  /** Barge-in: the part of the answer the user heard. */
  heard?: string;
  error?: string;
}

export interface SourceTurn extends TurnRecord {
  /** `YYYY-MM-DD/<session>#t<n>` */
  ref: string;
  session: string;
  n: number;
  redacted?: boolean;
}

/** Per-session high-water mark: `YYYY-MM-DD/<session>` → last ingested turn. */
export interface SourceCursor {
  /** Sessions in date directories before this date are fully ingested. */
  before?: string;
  sessions: Record<string, number>;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const TURN_RE = /^## t(\d+) · (\S+)$/;

export class SourceLog {
  constructor(private readonly dir: string) {}

  /** New session id `HHMMSS-<hex>` under today's (UTC) directory; lexical order = start order. */
  newSession(deviceId: string, now = new Date()): SourceSession {
    const date = now.toISOString().slice(0, 10);
    const id = `${now.toISOString().slice(11, 19).replace(/:/g, "")}-${randomBytes(3).toString("hex")}`;
    return new SourceSession(join(this.dir, date), `${date}/${id}`, deviceId);
  }

  async read(session: string): Promise<SourceTurn[]> {
    const path = this.file(session);
    if (!existsSync(path)) return [];
    return parseSession(session, await readFile(path, "utf8"));
  }

  /** Turns not yet covered by `cursor`, oldest session first. */
  async pending(cursor: SourceCursor): Promise<SourceTurn[]> {
    const out: SourceTurn[] = [];
    for (const session of await this.sessions(cursor.before)) {
      const done = cursor.sessions[session] ?? 0;
      for (const t of await this.read(session)) if (t.n > done && !t.redacted) out.push(t);
    }
    return out;
  }

  /** Session refs `YYYY-MM-DD/<id>` in date directories ≥ `from`. */
  async sessions(from?: string): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const dates = (await readdir(this.dir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (!from || d >= from)).sort();
    const out: string[] = [];
    for (const d of dates) {
      const files = (await readdir(join(this.dir, d))).filter((f) => f.endsWith(".md")).sort();
      for (const f of files) out.push(`${d}/${f.slice(0, -3)}`);
    }
    return out;
  }

  /** Replaces the content of one turn (forget). */
  async redact(ref: string, at = new Date().toISOString()): Promise<boolean> {
    const m = /^(\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]+)#t(\d+)$/.exec(ref);
    if (!m) throw new Error(`invalid source ref ${ref}`);
    const path = this.file(m[1]!);
    if (!existsSync(path)) return false;
    const lines = (await readFile(path, "utf8")).split("\n");
    const start = lines.findIndex((l) => TURN_RE.exec(l)?.[1] === m[2]);
    if (start < 0) return false;
    let end = start + 1;
    while (end < lines.length && !TURN_RE.test(lines[end]!)) end++;
    lines.splice(start + 1, end - start - 1, `**Redacted:** ${at}`, "");
    await writeFile(path, lines.join("\n"));
    return true;
  }

  private file(session: string): string {
    if (!/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]+$/.test(session)) throw new Error(`invalid session ref ${session}`);
    return join(this.dir, `${session}.md`);
  }
}

export class SourceSession {
  private n = 0;
  private created = false;

  constructor(
    private readonly dir: string,
    /** `YYYY-MM-DD/<id>` */
    readonly ref: string,
    private readonly deviceId: string,
  ) {}

  /** Ref the next appended turn will get. */
  nextRef(): string {
    return `${this.ref}#t${this.n + 1}`;
  }

  async append(t: TurnRecord): Promise<string> {
    const n = ++this.n;
    const path = join(this.dir, `${this.ref.split("/")[1]}.md`);
    if (!this.created) {
      await mkdir(this.dir, { recursive: true });
      if (!existsSync(path)) await writeFile(path, `# Session ${this.ref} · device ${oneLine(this.deviceId)}\n\n`);
      this.created = true;
    }
    const lines = [`## t${n} · ${t.at}`, `**User:** ${oneLine(t.user)}`, `**Assistant:** ${oneLine(t.assistant)}`];
    if (t.tools.length) lines.push(`**Tools:** ${t.tools.map(oneLine).join(", ")}`);
    if (t.heard !== undefined) lines.push(`**Interrupted; heard:** ${oneLine(t.heard)}`);
    if (t.error) lines.push(`**Error:** ${oneLine(t.error)}`);
    await appendFile(path, `${lines.join("\n")}\n\n`);
    return `${this.ref}#t${n}`;
  }
}

export function parseSession(session: string, text: string): SourceTurn[] {
  const out: SourceTurn[] = [];
  let cur: SourceTurn | undefined;
  for (const line of text.split("\n")) {
    const h = TURN_RE.exec(line);
    if (h) {
      const n = Number(h[1]);
      cur = { ref: `${session}#t${n}`, session, n, at: h[2]!, user: "", assistant: "", tools: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const f = /^\*\*([^*]+):\*\* ?(.*)$/.exec(line);
    if (!f) continue;
    const [, key, value = ""] = f;
    if (key === "User") cur.user = value;
    else if (key === "Assistant") cur.assistant = value;
    else if (key === "Tools") cur.tools = value.split(", ").filter(Boolean);
    else if (key === "Interrupted; heard") cur.heard = value;
    else if (key === "Error") cur.error = value;
    else if (key === "Redacted") cur.redacted = true;
  }
  return out;
}

/** Turn as compact text for the librarian. */
export function turnText(t: SourceTurn): string {
  if (t.redacted) return `[${t.ref}] (redacted)`;
  const parts = [`[${t.ref} ${t.at}]`, `User: ${t.user}`, `Assistant: ${t.assistant}`];
  if (t.heard !== undefined) parts.push(`(interrupted; user heard: "${t.heard}")`);
  if (t.tools.length) parts.push(`(tools: ${t.tools.join(", ")})`);
  return parts.join("\n");
}

/** Advances `cursor` over `taken` turns and moves `before` past fully ingested dates. */
export function advanceCursor(
  cursor: SourceCursor,
  taken: SourceTurn[],
  stillPending: SourceTurn[],
  now = new Date(),
): SourceCursor {
  const sessions = { ...cursor.sessions };
  for (const t of taken) sessions[t.session] = Math.max(sessions[t.session] ?? 0, t.n);
  // Keep a week of per-session marks (sessions may still be appended to); older dates are done.
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const firstPending = stillPending.map((t) => t.session.slice(0, 10)).sort()[0];
  const before = firstPending && firstPending < weekAgo ? firstPending : weekAgo;
  for (const s of Object.keys(sessions)) if (s.slice(0, 10) < before) delete sessions[s];
  return { before: cursor.before && cursor.before > before ? cursor.before : before, sessions };
}
