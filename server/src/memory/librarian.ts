// Librarian (spec 10 §10.7): background agent runs that ingest the source log and inbox into the
// wiki and temporal store, and lint them. One run per memory space at a time; triggers coalesce.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { hostToolId, hostToolServer } from "../inference/claude/backend.js";
import type { HostTool } from "../inference/types.js";
import type { Logger } from "../log.js";
import { writeBrief } from "./brief.js";
import type { Memory } from "./memory.js";
import { advanceCursor } from "./source-log.js";
import { commit } from "./space.js";
import {
  librarianReadTools,
  MEMORY_ADMIN_SERVER,
  MEMORY_SERVER,
  memoryAdminTools,
  type RunContext,
} from "./tools.js";
import { MAX_PAGE_BYTES, serializePage } from "./wiki.js";

export type RunType = "ingest" | "lint" | "rebuild";

export interface AgentRunRequest {
  systemPrompt: string;
  prompt: string;
  servers: Record<string, HostTool[]>;
  signal: AbortSignal;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  costUsd?: number;
}

/** Runs one librarian agent session to completion. */
export type AgentRunner = (req: AgentRunRequest) => Promise<AgentRunResult>;

/** Claude Agent SDK one-shot `query()`: memory tools only, no built-ins, no prompts. */
export function claudeRunner(model: string): AgentRunner {
  return async ({ systemPrompt, prompt, servers, signal }) => {
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort(), { once: true });
    const allowed = Object.entries(servers).flatMap(([s, tools]) => tools.map((t) => hostToolId(s, t.name)));
    const q = query({
      prompt,
      options: {
        model,
        systemPrompt,
        tools: [],
        allowedTools: allowed,
        mcpServers: Object.fromEntries(Object.entries(servers).map(([n, tools]) => [n, hostToolServer(n, tools)])),
        permissionMode: "dontAsk",
        settingSources: [],
        maxTurns: 80,
        abortController,
      },
    });
    for await (const msg of q) {
      if (msg.type !== "result") continue;
      const summary = msg.subtype === "success" ? msg.result : msg.subtype;
      return { ok: msg.subtype === "success", summary, costUsd: msg.total_cost_usd };
    }
    return { ok: false, summary: "agent ended without result" };
  };
}

export interface LibrarianOptions {
  /** Session idle time after its last turn before an ingest run. */
  idleMs: number;
  /** Debounce after memory.remember / memory.forget. */
  inboxDebounceMs: number;
  /** Lint after this many ingest runs. */
  lintAfterIngests: number;
  /** Local hour of the daily lint run; undefined disables. */
  lintHour?: number;
  timeZone?: string;
}

export const defaultLibrarianOptions: LibrarianOptions = {
  idleMs: 600_000,
  inboxDebounceMs: 30_000,
  lintAfterIngests: 20,
  lintHour: 4,
};

const BASE_PROMPT = `You are the librarian of a personal assistant's long-term memory. You maintain a markdown wiki
(entities and concepts) and a temporal fact store (preferences, decisions, events with validity time)
about one user, from transcripts of their voice conversations with the assistant.
You only have the memory tools. Work carefully and quietly; your final message is a short plain-text
summary of what you changed (one line per change), or "no changes".
Before creating a page, search for an existing one (titles, aliases) and update it instead.
Before asserting a preference or decision, query the open facts on the same topic: if one exists and the value changed, supersede it; if unchanged, do nothing.
Keep the wiki concise and factual; write in English; never invent facts.`;

const RUN_PROMPTS: Record<Exclude<RunType, "rebuild">, string> = {
  ingest: `Ingest run.
1. Call inbox_take for explicit remember / forget notes from the assistant.
2. Call sources_read (repeat while more remain) for new conversation turns.
3. File durable knowledge about the user's life: people, places, pets, organisations, projects, devices,
   interests, routines → wiki pages; preferences, decisions, events → temporal facts (with the source ref).
   Remember notes are explicit requests: always file them.
4. Forget notes: find the matching pages, sections and facts; remove the content (patch or delete pages,
   retract facts) and redact the source turns it came from (sources_redact), including the turn of the forget request.
   Do not file anything that a forget note covers.
5. Keep the \`user\` entity page current (name, household, location, timezone when known).`,
  lint: `Lint run. A report of mechanical findings follows. Fix what you can (merge duplicate pages,
supersede or retract contradictory open facts, close past events, create missing subject pages, split oversized pages,
link orphans from related pages); leave anything uncertain. Summarise what you fixed and what remains.`,
};

export class Librarian {
  private running: Promise<void> | undefined;
  private readonly queued = new Set<RunType>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private inboxTimer: NodeJS.Timeout | undefined;
  private lintTimer: NodeJS.Timeout | undefined;
  private readonly abort = new AbortController();
  private closed = false;
  private readonly log: Logger;
  private readonly opts: LibrarianOptions;

  constructor(
    private readonly mem: Memory,
    private readonly runner: AgentRunner,
    opts: Partial<LibrarianOptions>,
    log: Logger,
  ) {
    this.opts = { ...defaultLibrarianOptions, ...opts };
    this.log = log.child({ component: "librarian", space: mem.space.name });
    this.scheduleLint();
  }

  /** A turn was appended to `session`: ingest once the session has been idle for `idleMs`. */
  turnAppended(session: string): void {
    if (this.closed) return;
    clearTimeout(this.idleTimers.get(session));
    const t = setTimeout(() => {
      this.idleTimers.delete(session);
      void this.request("ingest");
    }, this.opts.idleMs);
    t.unref();
    this.idleTimers.set(session, t);
  }

  /** A remember / forget note was added (debounced ingest). */
  inboxChanged(): void {
    if (this.closed) return;
    clearTimeout(this.inboxTimer);
    this.inboxTimer = setTimeout(() => void this.request("ingest"), this.opts.inboxDebounceMs);
    this.inboxTimer.unref();
  }

  /** Queues a run; runs of the same type queued while one runs coalesce. Resolves when the queue is drained. */
  request(type: RunType): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.queued.add(type);
    this.running ??= this.drain().finally(() => (this.running = undefined));
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.queued.size && !this.closed) {
      const type: RunType = this.queued.has("ingest") ? "ingest" : this.queued.has("lint") ? "lint" : "rebuild";
      this.queued.delete(type);
      try {
        await this.run(type);
      } catch (e) {
        this.log.error("librarian_run_failed", { type, error: (e as Error).message });
      }
    }
  }

  private async run(type: RunType): Promise<void> {
    const mem = this.mem;
    const id = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
    const t0 = performance.now();
    const state = await mem.librarianState();
    const ctx: RunContext = { delivered: [], taken: [], changes: [] };
    let result: AgentRunResult = { ok: true, summary: "no agent run" };
    let pendingCount = 0;

    if (type !== "rebuild") {
      let prompt: string | undefined;
      if (type === "ingest") {
        const [pending, inbox] = await Promise.all([mem.sources.pending(state.cursor), mem.inbox()]);
        pendingCount = pending.length;
        if (pending.length || inbox.length) {
          prompt = `${RUN_PROMPTS.ingest}\n\nPending: ${pending.length} turns, ${inbox.length} inbox notes. ${this.nowLine()}`;
        }
      } else {
        const report = await lintReport(mem);
        if (report.length) prompt = `${RUN_PROMPTS.lint}\n\n${this.nowLine()}\n\n${report.join("\n")}`;
      }
      if (!prompt) {
        this.log.debug("librarian_skip", { type });
        if (type === "lint") await mem.recordRun({ ...state, ingestsSinceLint: 0, lastLint: new Date().toISOString() }, `## ${id} lint\n\nNo findings.`);
        return;
      }
      const schema = await readFile(mem.space.schema, "utf8").catch(() => "");
      result = await this.runner({
        systemPrompt: `${BASE_PROMPT}\n\n${schema}`,
        prompt,
        servers: {
          [MEMORY_SERVER]: librarianReadTools(mem),
          [MEMORY_ADMIN_SERVER]: memoryAdminTools(mem, ctx, () => mem.sources.pending(state.cursor)),
        },
        signal: this.abort.signal,
      });
    }

    // Finalise: state, index, brief, log entry, graph checkpoint, git commit.
    let next = state;
    if (result.ok && type === "ingest") {
      const pendingNow = await mem.sources.pending(state.cursor);
      const delivered = new Set(ctx.delivered.map((t) => t.ref));
      next = {
        ...state,
        cursor: advanceCursor(state.cursor, ctx.delivered, pendingNow.filter((t) => !delivered.has(t.ref))),
        ingestsSinceLint: state.ingestsSinceLint + 1,
      };
      await mem.ackInbox(ctx.taken);
    } else if (result.ok && type === "lint") {
      next = { ...state, ingestsSinceLint: 0, lastLint: new Date().toISOString() };
    }
    if (type === "rebuild") {
      await mem.wiki.load();
      mem.search.rebuild(mem.wiki.list());
    }
    await mem.wiki.writeIndex(mem.space.index);
    await writeBrief(mem, new Date(), this.opts.timeZone);
    const ms = Math.round(performance.now() - t0);
    const entry = [
      `## ${id} ${type}${result.ok ? "" : " (failed)"}`,
      "",
      `${new Date().toISOString()} · ${ms} ms${result.costUsd !== undefined ? ` · $${result.costUsd.toFixed(4)}` : ""} · ${ctx.delivered.length} turns · ${ctx.taken.length} notes`,
      "",
      ...ctx.changes.map((c) => `- ${c}`),
      ...(result.summary && result.summary !== "no agent run" ? ["", result.summary.trim()] : []),
    ].join("\n");
    await mem.recordRun(next, entry);
    mem.temporal.checkpoint();
    await commit(mem.space, `${id} ${type}${result.ok ? "" : " (failed)"}`).catch((e: Error) =>
      this.log.warn("memory_commit_failed", { error: e.message }),
    );
    this.log.info("librarian_run", {
      id,
      type,
      ok: result.ok,
      ms,
      turns: ctx.delivered.length,
      pending: pendingCount,
      notes: ctx.taken.length,
      changes: ctx.changes.length,
      ...(result.costUsd !== undefined ? { cost_usd: result.costUsd } : {}),
      ...(result.ok ? {} : { error: result.summary }),
    });
    if (next.ingestsSinceLint >= this.opts.lintAfterIngests) this.queued.add("lint");
  }

  private nowLine(): string {
    const tz = this.opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `Now: ${new Date().toISOString()}; user timezone ${tz}.`;
  }

  private scheduleLint(): void {
    if (this.opts.lintHour === undefined) return;
    const now = new Date();
    const at = new Date(now);
    at.setHours(this.opts.lintHour, 0, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    this.lintTimer = setTimeout(() => {
      void this.request("lint");
      this.scheduleLint();
    }, at.getTime() - now.getTime());
    this.lintTimer.unref();
  }

  /** Stops timers, aborts a running agent and waits for the run to finish. */
  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.idleTimers.values()) clearTimeout(t);
    clearTimeout(this.inboxTimer);
    clearTimeout(this.lintTimer);
    this.abort.abort();
    await this.running;
  }
}

/** Mechanical lint findings (spec §10.7 lint run). */
export async function lintReport(mem: Memory, now = new Date()): Promise<string[]> {
  const out: string[] = [];
  const pages = mem.wiki.list();
  const slugs = new Set(pages.map((p) => p.slug));
  const orphans = pages.filter((p) => p.slug !== "user" && mem.wiki.backlinks(p.slug).length === 0).map((p) => p.slug);
  if (orphans.length) out.push(`Orphan pages (no inbound links): ${orphans.join(", ")}`);
  for (const u of mem.wiki.unresolvedLinks()) out.push(`Unresolved links in ${u.slug}: ${u.missing.join(", ")}`);
  const names = new Map<string, string[]>();
  for (const p of pages) {
    for (const n of new Set([p.title, ...p.aliases].map((x) => x.toLowerCase()))) names.set(n, [...(names.get(n) ?? []), p.slug]);
  }
  for (const [n, s] of names) if (s.length > 1) out.push(`Possible duplicates (name "${n}"): ${s.join(", ")}`);
  for (const p of pages) {
    const size = Buffer.byteLength(serializePage(p));
    if (size > MAX_PAGE_BYTES) out.push(`Page ${p.slug} is ${size} bytes (max ${MAX_PAGE_BYTES})`);
  }
  const open = mem.temporal.facts().filter((f) => !f.valid_to);
  const byTopic = new Map<string, string[]>();
  for (const f of open) {
    if (f.kind === "event") continue;
    const who = String(f.attrs.holder ?? f.attrs.by ?? f.subject);
    const key = `${f.kind} ${who} ${String(f.attrs.topic ?? "")}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), `${f.id} "${f.text}"`]);
  }
  for (const [k, v] of byTopic) if (v.length > 1) out.push(`Several open facts on ${k}: ${v.join("; ")}`);
  const pastOpen = mem.temporal
    .facts({ kind: "event", history: true })
    .filter((f) => !f.valid_to && !f.attrs.recurrence && Date.parse(f.valid_from) < now.getTime());
  for (const f of pastOpen) out.push(`Past event without end: ${f.id} "${f.text}"`);
  const noPage = [...new Set(mem.temporal.facts({ history: true }).map((f) => f.subject))].filter((s) => !slugs.has(s));
  if (noPage.length) out.push(`Fact subjects without a wiki page: ${noPage.join(", ")}`);
  const linked = new Set(pages.flatMap((p) => p.facts));
  const unlinked = mem.temporal.facts().filter((f) => !linked.has(f.id) && slugs.has(f.subject));
  for (const f of unlinked.slice(0, 30)) out.push(`Fact not listed on its subject page ${f.subject}: ${f.id}`);
  return out;
}
