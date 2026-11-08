// Memory tools (spec 10 §10.6, §10.7): `memory` (voice agent) and `memory_admin` (librarian).
import { z } from "zod";
import type { HostTool, ToolOutcome } from "../inference/types.js";
import type { InboxEntry, Memory } from "./memory.js";
import { eventsBetween, formatWhen } from "./brief.js";
import { searchFacts, tokens } from "./search.js";
import { turnText, type SourceTurn } from "./source-log.js";
import { FACT_KINDS, factInput, factLine, topicMatches, type Fact, type FactInput } from "./temporal.js";
import { pageMeta, PAGE_TYPES, sections, SLUG, type Page } from "./wiki.js";

export const MEMORY_SERVER = "memory";
export const MEMORY_ADMIN_SERVER = "memory_admin";

const iso = z.iso.datetime({ offset: true });
const slug = z.string().regex(SLUG);

function hostTool<S extends z.ZodObject>(
  name: string,
  description: string,
  schema: S,
  fn: (args: z.output<S>) => Promise<string> | string,
  policy: HostTool["policy"] = "allow",
): HostTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>,
    policy,
    async call(args): Promise<ToolOutcome> {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return { ok: false, text: `invalid arguments: ${z.prettifyError(parsed.error)}` };
      try {
        return { ok: true, text: await fn(parsed.data) };
      } catch (e) {
        return { ok: false, text: (e as Error).message };
      }
    },
  };
}

function resolveFacts(mem: Memory, ids: string[]): Fact[] {
  return ids.length ? mem.temporal.facts({ ids, history: true }) : [];
}

function renderPage(mem: Memory, p: Page, section?: string): string {
  const head = [
    `slug: ${p.slug}`,
    `type: ${p.type}, kind: ${p.kind}`,
    `title: ${p.title}${p.aliases.length ? ` (aliases: ${p.aliases.join(", ")})` : ""}`,
    `summary: ${p.summary}`,
    `updated: ${p.updated ?? "?"}`,
  ];
  let body = p.body;
  if (section) {
    const s = sections(p.body).find((x) => x.heading.toLowerCase() === section.toLowerCase());
    if (!s) {
      const names = sections(p.body).map((x) => x.heading);
      return `${head.join("\n")}\n\nNo section "${section}". Sections: ${names.join(", ") || "none"}`;
    }
    body = `## ${s.heading}\n\n${s.text}`;
  }
  const facts = resolveFacts(mem, p.facts);
  const factText = facts.length ? `\n\nLinked facts:\n${facts.map((f) => `- ${factLine(f)}`).join("\n")}` : "";
  return `${head.join("\n")}\n\n${body.trim()}${factText}`;
}

/** Topic key prefix (`coffee` ⊃ `coffee.milk`) or any shared word ("milk in coffee"). */
export function topicLike(factTopic: string, query: string): boolean {
  if (!factTopic) return false;
  if (topicMatches(factTopic, query)) return true;
  const words = new Set(tokens(factTopic.replace(/[._-]/g, " ")));
  return tokens(query.replace(/[._-]/g, " ")).some((t) => words.has(t));
}

export interface MemoryToolContext {
  /** Source log ref of the turn in progress. */
  sourceRef(): string | undefined;
  /** A remember/forget note was added to the inbox. */
  onInbox(): void;
  timeZone?: string;
}

/** Voice-agent tools (server `memory`). */
export function memoryTools(mem: Memory, ctx: MemoryToolContext): HostTool[] {
  const note = async (op: InboxEntry["op"], text: string, kindHint?: string) => {
    const source = ctx.sourceRef();
    await mem.addInbox({ at: new Date().toISOString(), op, text, ...(kindHint ? { kindHint } : {}), ...(source ? { source } : {}) });
    ctx.onInbox();
  };
  return [
    hostTool(
      "index",
      "List the pages of the long-term memory wiki (one line per page: slug, kind, summary).",
      z.object({ type: z.enum(PAGE_TYPES).optional(), kind: z.string().optional() }),
      ({ type, kind }) => {
        const lines = mem.wiki.indexLines({ ...(type ? { type } : {}), ...(kind ? { kind } : {}) });
        if (!lines.length) return "The memory wiki has no pages yet.";
        return lines.length > 200 ? `${lines.slice(0, 200).join("\n")}\n… (${lines.length - 200} more)` : lines.join("\n");
      },
    ),
    hostTool(
      "search",
      "Search long-term memory (wiki pages and remembered facts) about the user's life, people, places, plans and preferences.",
      z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).optional() }),
      async ({ query, limit }) => {
        const pages = mem.search.search(query, limit ?? 8);
        // All valid times: superseded preferences answer "before" questions; the window is in each line.
        const facts = searchFacts(mem.temporal.facts({ history: true }), query, limit ?? 8);
        const q = new Set(tokens(query));
        const notes = (await mem.inbox()).filter((e) => e.op === "remember" && tokens(e.text).some((t) => q.has(t)));
        const out: string[] = [];
        if (notes.length) {
          out.push("Just noted (not yet filed):");
          for (const e of notes.slice(-(limit ?? 8))) out.push(`- ${e.at.slice(0, 10)}: ${e.text}`);
        }
        if (pages.length) {
          out.push("Pages:");
          for (const p of pages) {
            const secs = p.sections.length ? ` [sections: ${p.sections.join(", ")}]` : "";
            out.push(`- ${p.slug} (${p.kind}) ${p.title} — ${p.summary}${secs} score ${p.score}`);
          }
        }
        if (facts.length) {
          out.push("Facts:");
          for (const f of facts) out.push(`- ${factLine(f)}`);
        }
        return out.length ? out.join("\n") : "Nothing found in memory.";
      },
    ),
    hostTool(
      "read",
      "Read one memory wiki page, or one of its sections (H2 heading).",
      z.object({ slug, section: z.string().max(120).optional() }),
      ({ slug: s, section }) => {
        const p = mem.wiki.get(s);
        return p ? renderPage(mem, p, section) : `No page "${s}".`;
      },
    ),
    hostTool(
      "facts",
      "Query remembered preferences, decisions and events with their validity time. Default: what is true now. " +
        "`history: true`: all versions including superseded ones (questions about before, used to, changes); " +
        "`at`: what was true at that time; `as_of`: what was recorded by then; `from`/`to`: events in a range.",
      z.object({
        kind: z.enum(FACT_KINDS).optional(),
        subject: slug.optional(),
        topic: z.string().max(100).optional().describe("Topic key or words, e.g. coffee.milk or coffee"),
        at: iso.optional(),
        as_of: iso.optional(),
        history: z.boolean().optional(),
        from: iso.optional(),
        to: iso.optional(),
      }),
      async ({ kind, subject, topic, at, as_of, history, from, to }) => {
        if (from || to) {
          const f0 = new Date(from ?? Date.now());
          const t0 = new Date(to ?? f0.getTime() + 30 * 86_400_000);
          const evs = eventsBetween(mem, f0, t0).filter((e) => !subject || e.fact.subject === subject);
          if (!evs.length) return "No events in that range.";
          return evs
            .slice(0, 50)
            .map((e) => `- ${formatWhen(e.start, ctx.timeZone)} (${e.start.toISOString()}): ${e.fact.text} [${e.fact.id}]`)
            .join("\n");
        }
        const onTopic = (f: Fact) => !topic || topicLike(String(f.attrs.topic ?? ""), topic);
        const facts = mem.temporal
          .facts({
            ...(kind ? { kind } : {}),
            ...(subject ? { subject } : {}),
            ...(at ? { at } : {}),
            ...(as_of ? { asOf: as_of } : {}),
            ...(history ? { history } : {}),
          })
          .filter(onTopic);
        const lines = facts.slice(0, 100).map((f) => `- ${factLine(f)}`);
        if (!history && !at && !as_of) {
          // Earlier versions inline: "what did I have before" needs no second call.
          const current = new Set(facts.map((f) => f.id));
          const older = mem.temporal
            .facts({ ...(kind ? { kind } : {}), ...(subject ? { subject } : {}), history: true })
            .filter((f) => onTopic(f) && !current.has(f.id) && f.kind !== "event" && f.valid_to)
            .reverse()
            .slice(0, 20);
          if (older.length) lines.push("Earlier (superseded) versions:", ...older.map((f) => `- ${factLine(f)}`));
        }
        if (!at && !as_of) {
          const notes = (await mem.inbox()).filter((e) => e.op === "remember");
          if (notes.length) lines.push("Just noted (not yet filed):", ...notes.slice(-20).map((e) => `- ${e.at.slice(0, 10)}: ${e.text}`));
        }
        return lines.length ? lines.join("\n") : "No matching facts.";
      },
    ),
    hostTool(
      "remember",
      "Store something in long-term memory: one clear sentence about the user (preference, decision, plan, event, person, detail).",
      z.object({
        text: z.string().min(1).max(500),
        kind_hint: z.enum(["preference", "decision", "event", "person", "place", "detail"]).optional(),
      }),
      async ({ text, kind_hint }) => {
        await note("remember", text, kind_hint);
        return "Noted; it will be filed in memory shortly.";
      },
    ),
    hostTool(
      "forget",
      "Forget something stored in long-term memory (asks the user on the device first).",
      z.object({ text: z.string().min(1).max(500).describe("What to forget") }),
      async ({ text }) => {
        await note("forget", text);
        return "It will be removed from memory shortly.";
      },
      "ask",
    ),
  ];
}

/** Per-run state shared by the librarian and its admin tools. */
export interface RunContext {
  /** Turns returned by sources_read; the cursor advances over them when the run succeeds. */
  delivered: SourceTurn[];
  /** Inbox entries returned by inbox_take; removed from the inbox when the run succeeds. */
  taken: InboxEntry[];
  /** Mutations made (for the log entry). */
  changes: string[];
}

const MAX_SOURCE_CHARS = 40_000;

const metaInput = pageMeta.omit({ created: true, updated: true });

/** Librarian tools (server `memory_admin`); dotted spec names map to `_` (wiki.write_page → wiki_write_page). */
export function memoryAdminTools(mem: Memory, run: RunContext, pendingTurns: () => Promise<SourceTurn[]>): HostTool[] {
  const changed = (s: string) => {
    run.changes.push(s);
    return s;
  };
  /** Rewrites fact subjects / holders after a slug rename or merge (retract + re-assert, same window). */
  const resubject = (from: string, to: string): Map<string, string> => {
    const ids = new Map<string, string>();
    for (const f of mem.temporal.facts({ history: true })) {
      const hit = f.subject === from || f.attrs.holder === from || f.attrs.by === from || (Array.isArray(f.attrs.with) && f.attrs.with.includes(from));
      if (!hit) continue;
      const attrs = { ...f.attrs };
      for (const k of ["holder", "by"]) if (attrs[k] === from) attrs[k] = to;
      if (Array.isArray(attrs.with)) attrs.with = [...new Set(attrs.with.map((w) => (w === from ? to : w)))];
      mem.temporal.retract(f.id);
      const next = mem.temporal.assert({
        ...attrs,
        kind: f.kind,
        subject: f.subject === from ? to : f.subject,
        text: f.text,
        source: f.source,
        stated_at: f.stated_at,
        confidence: f.confidence,
        valid_from: f.valid_from,
        ...(f.valid_to ? { valid_to: f.valid_to } : {}),
      } as FactInput);
      ids.set(f.id, next.id);
    }
    return ids;
  };
  const relinkFacts = async (ids: Map<string, string>) => {
    if (!ids.size) return;
    for (const p of mem.wiki.list()) {
      if (!p.facts.some((id) => ids.has(id))) continue;
      await mem.wiki.write(p.slug, { ...p, facts: p.facts.map((id) => ids.get(id) ?? id) }, p.body);
    }
  };
  const factInputSchema = z.object({ fact: factInput });

  return [
    hostTool(
      "wiki_write_page",
      "Create or replace a wiki page (frontmatter fields + markdown body with H2 sections).",
      z.object({ slug, meta: metaInput, body: z.string().max(8000) }),
      async ({ slug: s, meta, body }) => {
        const p = await mem.wiki.write(s, meta, body);
        return changed(`wrote ${p.type} ${p.slug}`);
      },
    ),
    hostTool(
      "wiki_patch_section",
      "Replace or append to one H2 section of a page (created if missing).",
      z.object({ slug, heading: z.string().min(1).max(120), content: z.string().max(8000), mode: z.enum(["replace", "append"]).optional() }),
      async ({ slug: s, heading, content, mode }) => {
        await mem.wiki.patchSection(s, heading, content, mode ?? "replace");
        return changed(`patched ${s}#${heading}`);
      },
    ),
    hostTool(
      "wiki_rename",
      "Rename a page slug; rewrites [[links]] and fact subjects.",
      z.object({ from: slug, to: slug }),
      async ({ from, to }) => {
        await mem.wiki.rename(from, to);
        await relinkFacts(resubject(from, to));
        return changed(`renamed ${from} → ${to}`);
      },
    ),
    hostTool(
      "wiki_merge",
      "Merge page `from` into page `into` (aliases, sources, facts, sections); rewrites [[links]] and fact subjects; deletes `from`.",
      z.object({ from: slug, into: slug }),
      async ({ from, into }) => {
        await mem.wiki.merge(from, into);
        await relinkFacts(resubject(from, into));
        return changed(`merged ${from} → ${into}`);
      },
    ),
    hostTool("wiki_delete", "Delete a page; links to it stay unresolved.", z.object({ slug }), async ({ slug: s }) => {
      await mem.wiki.delete(s);
      return changed(`deleted ${s}`);
    }),
    hostTool(
      "facts_assert",
      "Assert a new temporal fact (preference, decision or event). Returns its id; add the id to the subject page's `facts`.",
      factInputSchema,
      ({ fact }) => {
        const f = mem.temporal.assert(fact);
        changed(`asserted ${f.id}`);
        return `asserted ${factLine(f)}`;
      },
    ),
    hostTool(
      "facts_supersede",
      "Supersede an open fact: it ends at `at` and the new fact is valid from `at`. For changed preferences and revised decisions.",
      z.object({ id: z.string(), at: iso, fact: factInput }),
      async ({ id, at, fact }) => {
        const { closed, next } = mem.temporal.supersede(id, fact, at);
        changed(`superseded ${id} → ${next.id}`);
        return `closed ${factLine(closed)}\nnew ${factLine(next)}`;
      },
    ),
    hostTool("facts_retract", "Retract a fact (wrong or forgotten).", z.object({ id: z.string() }), ({ id }) => {
      if (!mem.temporal.retract(id)) return `no fact ${id}`;
      return changed(`retracted ${id}`);
    }),
    hostTool(
      "facts_query",
      "Raw read-only Datalog query on the temporal store, e.g. (query [:find ?e ?t :any-valid-time :where [?e :fact/text ?t]]). Max 500 rows.",
      z.object({ datalog: z.string().max(4000) }),
      ({ datalog }) => JSON.stringify(mem.temporal.query(datalog)),
    ),
    hostTool(
      "sources_read",
      "Read conversation turns not yet ingested (default), or one session (`session` = YYYY-MM-DD/<id>). Call again while it says more remain.",
      z.object({ session: z.string().max(80).optional() }),
      async ({ session }) => {
        if (session) return (await mem.sources.read(session)).map(turnText).join("\n\n") || "No such session.";
        const seen = new Set(run.delivered.map((t) => t.ref));
        const rest = (await pendingTurns()).filter((t) => !seen.has(t.ref));
        const out: string[] = [];
        let size = 0;
        for (const t of rest) {
          const s = turnText(t);
          if (out.length && size + s.length > MAX_SOURCE_CHARS) break;
          out.push(s);
          size += s.length;
          run.delivered.push(t);
        }
        const more = rest.length - out.length;
        if (!out.length) return "No new turns.";
        return `${out.join("\n\n")}\n\n${more > 0 ? `(${more} more turns remain; call sources_read again)` : "(no more turns)"}`;
      },
    ),
    hostTool(
      "sources_redact",
      "Redact one source log turn (forget requests). `ref` = YYYY-MM-DD/<session>#t<n>.",
      z.object({ ref: z.string().max(100) }),
      async ({ ref }) => ((await mem.sources.redact(ref)) ? changed(`redacted ${ref}`) : `no turn ${ref}`),
    ),
    hostTool("inbox_take", "Read pending remember / forget notes from the voice agent.", z.object({}), async () => {
      const entries = (await mem.inbox()).filter((e) => !run.taken.some((t) => t.line === e.line));
      run.taken.push(...entries);
      if (!entries.length) return "Inbox empty.";
      return entries.map((e) => `- ${e.at} ${e.op}${e.kindHint ? ` [${e.kindHint}]` : ""}${e.source ? ` (source ${e.source})` : ""}: ${e.text}`).join("\n");
    }),
  ];
}

/** Read-only subset of the voice-agent tools for the librarian. */
export function librarianReadTools(mem: Memory): HostTool[] {
  const ro = new Set(["index", "search", "read", "facts"]);
  return memoryTools(mem, { sourceRef: () => undefined, onInbox: () => {} }).filter((t) => ro.has(t.name));
}
