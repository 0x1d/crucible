// Memory facade (spec 10): one memory space with its wiki, search index, temporal store,
// source log, inbox and librarian log.
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import type { Logger } from "../log.js";
import { SearchIndex } from "./search.js";
import { openSpace, type MemorySpace } from "./space.js";
import { SourceLog, type SourceCursor } from "./source-log.js";
import { TemporalStore } from "./temporal.js";
import { Wiki } from "./wiki.js";

export interface InboxEntry {
  at: string;
  op: "remember" | "forget";
  text: string;
  kindHint?: string;
  source?: string;
  /** Raw line in inbox.md. */
  line: string;
}

export interface LibrarianState {
  cursor: SourceCursor;
  ingestsSinceLint: number;
  lastLint?: string;
}

export class Memory {
  readonly wiki: Wiki;
  readonly search = new SearchIndex();
  readonly sources: SourceLog;
  private constructor(
    readonly space: MemorySpace,
    readonly temporal: TemporalStore,
    private readonly log: Logger,
  ) {
    this.wiki = new Wiki(space.wiki);
    this.sources = new SourceLog(space.sources);
    this.wiki.onChange = (changes) => {
      if (changes.length === 0) this.search.rebuild(this.wiki.list());
      for (const c of changes) this.search.update(c.slug, c.deleted ? undefined : this.wiki.get(c.slug));
    };
  }

  static async open(rootDir: string, name: string, log: Logger, opts: { watch?: boolean } = {}): Promise<Memory> {
    const space = await openSpace(rootDir, name);
    const m = new Memory(space, TemporalStore.open(space.graph), log.child({ component: "memory", space: name }));
    await m.wiki.load();
    m.search.rebuild(m.wiki.list());
    if (opts.watch) m.wiki.watch();
    m.log.info("memory_open", { pages: m.wiki.list().length, facts: m.temporal.facts().length });
    return m;
  }

  // -- inbox -----------------------------------------------------------------

  async addInbox(e: Omit<InboxEntry, "line">): Promise<void> {
    const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
    const hint = e.kindHint ? ` [${oneLine(e.kindHint)}]` : "";
    const src = e.source ? ` (${e.source})` : "";
    await appendFile(this.space.inbox, `- ${e.at} ${e.op}${hint}${src}: ${oneLine(e.text)}\n`);
  }

  async inbox(): Promise<InboxEntry[]> {
    if (!existsSync(this.space.inbox)) return [];
    const out: InboxEntry[] = [];
    for (const line of (await readFile(this.space.inbox, "utf8")).split("\n")) {
      const m = /^- (\S+) (remember|forget)(?: \[([^\]]*)\])?(?: \(([^)]*)\))?: (.*)$/.exec(line);
      if (!m) continue;
      out.push({
        at: m[1]!,
        op: m[2] as InboxEntry["op"],
        ...(m[3] ? { kindHint: m[3] } : {}),
        ...(m[4] ? { source: m[4] } : {}),
        text: m[5]!,
        line,
      });
    }
    return out;
  }

  /** Removes processed entries; entries added meanwhile stay. */
  async ackInbox(entries: InboxEntry[]): Promise<void> {
    if (!entries.length) return;
    const done = new Set(entries.map((e) => e.line));
    const text = existsSync(this.space.inbox) ? await readFile(this.space.inbox, "utf8") : "";
    const rest = text.split("\n").filter((l) => l && !done.has(l));
    await writeFile(this.space.inbox, rest.length ? `${rest.join("\n")}\n` : "");
  }

  // -- librarian log (wiki/log.md) ----------------------------------------------

  async librarianState(): Promise<LibrarianState> {
    const { meta } = await this.readLog();
    const sessions: Record<string, number> = {};
    for (const ref of (meta.ingested as string[] | undefined) ?? []) {
      const m = /^(.+)#t(\d+)$/.exec(ref);
      if (m) sessions[m[1]!] = Number(m[2]);
    }
    return {
      cursor: { ...(typeof meta.ingested_before === "string" ? { before: meta.ingested_before } : {}), sessions },
      ingestsSinceLint: Number(meta.ingests_since_lint ?? 0),
      ...(typeof meta.last_lint === "string" ? { lastLint: meta.last_lint } : {}),
    };
  }

  /** Writes the state frontmatter and appends one run entry. */
  async recordRun(state: LibrarianState, entry: string): Promise<void> {
    const { body } = await this.readLog();
    const meta = {
      ...(state.cursor.before ? { ingested_before: state.cursor.before } : {}),
      ingested: Object.entries(state.cursor.sessions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, n]) => `${s}#t${n}`),
      ingests_since_lint: state.ingestsSinceLint,
      ...(state.lastLint ? { last_lint: state.lastLint } : {}),
    };
    const head = new YAML.Document(meta);
    await writeFile(this.space.log, `---\n${head.toString({ lineWidth: 0 }).trimEnd()}\n---\n${body.trimEnd()}\n\n${entry.trim()}\n`);
  }

  private async readLog(): Promise<{ meta: Record<string, unknown>; body: string }> {
    const text = existsSync(this.space.log) ? await readFile(this.space.log, "utf8") : "";
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
    if (!m) return { meta: {}, body: text || "\n# Librarian log\n" };
    return { meta: (YAML.parse(m[1]!) as Record<string, unknown> | null) ?? {}, body: m[2]! };
  }

  close(): void {
    this.wiki.close();
    try {
      this.temporal.checkpoint();
    } finally {
      this.temporal.close();
    }
  }
}
