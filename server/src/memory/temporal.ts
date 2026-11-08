// Temporal store (spec 10 §10.4): preferences, decisions, events as bi-temporal minigraf facts.
import { randomUUID } from "node:crypto";
import minigraf from "minigraf";
import { z } from "zod";

const { MiniGrafDb } = minigraf;
type Db = InstanceType<typeof MiniGrafDb>;

export const FACT_KINDS = ["preference", "decision", "event"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Entity keyword namespace per kind (`:pref/<uuid>`, id `pref:<uuid>`). */
const NS: Record<FactKind, string> = { preference: "pref", decision: "decision", event: "event" };
const KIND_OF_NS: Record<string, FactKind> = { pref: "preference", decision: "decision", event: "event" };

/** File-backed serialised fact limit (spec §10.4). */
export const MAX_FACT_BYTES = 4080;

const iso = z.iso.datetime({ offset: true });
const slug = z.string().regex(/^[a-z0-9-]{1,64}$/);

const common = {
  subject: slug.describe("Wiki slug the fact is about; 'user' for the primary user"),
  text: z.string().min(1).max(400).describe("One-sentence statement, speakable"),
  source: z.string().max(200).describe("Source log ref YYYY-MM-DD/<session>#t<n>"),
  stated_at: iso.describe("ISO timestamp of the source turn"),
  confidence: z.enum(["stated", "inferred"]).default("stated"),
  valid_from: iso.optional().describe("Start of validity; default stated_at"),
  valid_to: iso.optional().describe("End of validity; open-ended if absent (events: default start + 1 s)"),
};

export const factInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preference"),
    ...common,
    holder: slug.default("user"),
    topic: z.string().regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/).describe("Normalised dotted topic, e.g. coffee.milk"),
    value: z.string().min(1).max(200),
    polarity: z.enum(["likes", "dislikes", "neutral"]),
  }),
  z.object({
    kind: z.literal("decision"),
    ...common,
    topic: z.string().min(1).max(100),
    choice: z.string().min(1).max(200),
    reason: z.string().max(400).optional(),
    by: slug.default("user"),
  }),
  z.object({
    kind: z.literal("event"),
    ...common,
    title: z.string().min(1).max(200),
    where: z.string().max(200).optional(),
    with: z.array(slug).max(20).optional(),
    recurrence: z.string().regex(/^[A-Z]+=/).max(200).optional().describe("RFC 5545 RRULE, e.g. FREQ=WEEKLY;BYDAY=MO"),
    remind: z.boolean().optional(),
  }),
]);
export type FactInput = z.input<typeof factInput>;
type ParsedFact = z.output<typeof factInput>;

export interface Fact {
  id: string;
  kind: FactKind;
  subject: string;
  text: string;
  source: string;
  stated_at: string;
  confidence: "stated" | "inferred";
  valid_from: string;
  valid_to?: string;
  /** Kind-specific attributes (holder, topic, value, polarity, choice, title, with, …). */
  attrs: Record<string, string | boolean | string[]>;
}

export interface FactQuery {
  kind?: FactKind;
  subject?: string;
  holder?: string;
  /** Topic prefix (`coffee` matches `coffee.milk`). */
  topic?: string;
  ids?: string[];
  /** Valid time (default now). */
  at?: string;
  /** Transaction time: the store as it was at this instant. */
  asOf?: string;
  /** All valid times (superseded facts included), ordered by valid_from. */
  history?: boolean;
}

/** Datom value as EDN. Strings: JSON escaping is EDN-compatible for \" \\ \n \t. */
type Value = { kw: string } | string | boolean;
function edn(v: Value): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  return `:${v.kw}`;
}

const ATTR_PREFIX: Record<FactKind, string> = { preference: "pref", decision: "decision", event: "event" };
const KEYWORD_ATTRS = new Set(["polarity"]);
/** Attributes stored as keywords (query results return them as ":name" strings). */
const KEYWORD_DATOMS = new Set([":fact/kind", ":fact/confidence", ":pref/polarity"]);
const COMMON_KEYS = new Set(["kind", "subject", "text", "source", "stated_at", "confidence", "valid_from", "valid_to"]);

export class TemporalStore {
  private cache: Fact[] | undefined;

  private constructor(private readonly db: Db) {}

  /** One handle per file per process (minigraf constraint). */
  static open(path: string): TemporalStore {
    return new TemporalStore(new MiniGrafDb(path));
  }

  static inMemory(): TemporalStore {
    return new TemporalStore(MiniGrafDb.inMemory());
  }

  private exec(datalog: string): unknown {
    return JSON.parse(this.db.execute(datalog));
  }

  /** Raw read-only Datalog query (librarian `facts.query`). */
  query(datalog: string): { results: unknown[][]; variables: string[] } {
    const s = datalog.trim();
    if (!/^\(query\s/.test(s)) throw new Error("only (query …) is allowed");
    const r = this.exec(s) as { results: unknown[][]; variables: string[] };
    return { ...r, results: r.results.slice(0, 500) };
  }

  /** Asserts a new fact; returns it with its id. */
  assert(input: FactInput): Fact {
    const f = factInput.parse(input);
    const id = `${NS[f.kind]}:${randomUUID()}`;
    const fact = toFact(id, f);
    this.write(fact);
    return fact;
  }

  /**
   * Supersede (spec §10.4.2): closes the open fact `id` at `at` (retract, re-assert with
   * valid_to) and asserts `next` valid from `at`.
   */
  supersede(id: string, next: FactInput, at: string): { closed: Fact; next: Fact } {
    const old = this.get(id);
    if (!old) throw new Error(`no current fact ${id}`);
    if (old.valid_to) throw new Error(`fact ${id} is not open-ended`);
    const parsed = factInput.parse({ ...next, valid_from: at });
    if (parsed.kind !== old.kind) throw new Error(`kind mismatch: ${old.kind} → ${parsed.kind}`);
    if (Date.parse(at) <= Date.parse(old.valid_from)) throw new Error("supersede time must be after valid_from");
    this.retractDatoms(id, this.datoms(id, true));
    const closed = { ...old, valid_to: at };
    this.write(closed);
    const fresh = toFact(`${NS[parsed.kind]}:${randomUUID()}`, parsed);
    this.write(fresh);
    return { closed, next: fresh };
  }

  /** Writes an existing fact with its id and window (compact: rebuild without retracted datoms). */
  restore(f: Fact): void {
    entityKw(f.id);
    this.write(f);
  }

  /** Retracts every datom of the fact (stays visible under `asOf`). */
  retract(id: string): boolean {
    const datoms = this.datoms(id, true);
    if (datoms.length === 0) return false;
    this.retractDatoms(id, datoms);
    return true;
  }

  get(id: string, q: Omit<FactQuery, "ids"> = {}): Fact | undefined {
    return this.facts({ ...q, ids: [id] })[0];
  }

  facts(q: FactQuery = {}): Fact[] {
    const cached = !q.at && !q.asOf && !q.history;
    let all: Fact[];
    if (cached && this.cache) all = this.cache;
    else {
      const temporal = [
        q.history ? ":any-valid-time" : q.at ? `:valid-at ${edn(q.at)}` : "",
        q.asOf ? `:as-of ${edn(q.asOf)}` : "",
      ].join(" ");
      const r = this.exec(`(query [:find ?e ?a ?v ${temporal} :where [?e :fact/kind _] [?e ?a ?v]])`) as {
        results: [string, string, unknown][];
      };
      all = groupFacts(r.results);
      if (cached) this.cache = all;
    }
    const ids = q.ids && new Set(q.ids);
    return all
      .filter(
        (f) =>
          (!ids || ids.has(f.id)) &&
          (!q.kind || f.kind === q.kind) &&
          (!q.subject || f.subject === q.subject) &&
          (!q.holder || f.attrs.holder === q.holder) &&
          (!q.topic || topicMatches(String(f.attrs.topic ?? ""), q.topic)),
      )
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.id.localeCompare(b.id));
  }

  checkpoint(): void {
    this.db.checkpoint();
  }

  close(): void {
    this.db.close();
  }

  /** Writes one fact; one value per (entity, attribute) per transaction (minigraf #371). */
  private write(f: Fact): void {
    const kw = entityKw(f.id);
    const datoms = factDatoms(f);
    if (JSON.stringify(datoms).length > MAX_FACT_BYTES) throw new Error(`fact exceeds ${MAX_FACT_BYTES} bytes`);
    const window = `{:valid-from ${edn(f.valid_from)}${f.valid_to ? ` :valid-to ${edn(f.valid_to)}` : ""}}`;
    // Multi-valued attributes (event/with): extra values in their own transactions.
    const batches: Array<Array<[string, Value]>> = [];
    for (const d of datoms) {
      const b = batches.find((x) => !x.some(([a]) => a === d[0]));
      if (b) b.push(d);
      else batches.push([d]);
    }
    for (const b of batches) {
      this.exec(`(transact ${window} [${b.map(([a, v]) => `[${kw} :${a} ${edn(v)}]`).join(" ")}])`);
    }
    this.cache = undefined;
  }

  /** Current datoms of a fact (any valid time when `anyTime`). */
  private datoms(id: string, anyTime: boolean): Array<[string, unknown]> {
    const r = this.exec(`(query [:find ?a ?v ${anyTime ? ":any-valid-time" : ""} :where [${entityKw(id)} ?a ?v]])`) as {
      results: [string, unknown][];
    };
    return r.results;
  }

  private retractDatoms(id: string, datoms: Array<[string, unknown]>): void {
    const kw = entityKw(id);
    const batches: Array<Array<[string, unknown]>> = [];
    for (const d of datoms) {
      const b = batches.find((x) => !x.some(([a]) => a === d[0]));
      if (b) b.push(d);
      else batches.push([d]);
    }
    for (const b of batches) {
      this.exec(`(retract [${b.map(([a, v]) => `[${kw} ${a} ${rawEdn(a, v)}]`).join(" ")}])`);
    }
    this.cache = undefined;
  }
}

function entityKw(id: string): string {
  const m = /^(pref|decision|event):([0-9a-f-]{36})$/.exec(id);
  if (!m) throw new Error(`invalid fact id ${id}`);
  return `:${m[1]}/${m[2]}`;
}

/** Query result value back to EDN (keywords come back as ":kw" strings). */
function rawEdn(attr: string, v: unknown): string {
  if (typeof v === "string" && KEYWORD_DATOMS.has(attr)) return v;
  if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
  throw new Error(`unsupported datom value ${JSON.stringify(v)}`);
}

export function topicMatches(topic: string, prefix: string): boolean {
  return topic === prefix || topic.startsWith(`${prefix}.`);
}

function toFact(id: string, f: ParsedFact): Fact {
  const validFrom = f.valid_from ?? f.stated_at;
  let validTo = f.valid_to;
  if (f.kind === "event" && !validTo) validTo = new Date(Date.parse(validFrom) + 1000).toISOString();
  if (validTo && Date.parse(validTo) <= Date.parse(validFrom)) throw new Error("valid_to must be after valid_from");
  const attrs: Fact["attrs"] = {};
  for (const [k, v] of Object.entries(f)) {
    if (COMMON_KEYS.has(k) || v === undefined) continue;
    attrs[k] = v as string | boolean | string[];
  }
  return {
    id,
    kind: f.kind,
    subject: f.subject,
    text: f.text,
    source: f.source,
    stated_at: f.stated_at,
    confidence: f.confidence,
    valid_from: validFrom,
    ...(validTo ? { valid_to: validTo } : {}),
    attrs,
  };
}

/** Datoms of a fact; the id and valid window are mirrored as attributes (not queryable otherwise). */
function factDatoms(f: Fact): Array<[string, Value]> {
  const out: Array<[string, Value]> = [
    ["fact/id", f.id],
    ["fact/kind", { kw: f.kind }],
    ["fact/subject", f.subject],
    ["fact/text", f.text],
    ["fact/source", f.source],
    ["fact/stated-at", f.stated_at],
    ["fact/confidence", { kw: f.confidence }],
    ["fact/valid-from", f.valid_from],
  ];
  if (f.valid_to) out.push(["fact/valid-to", f.valid_to]);
  const p = ATTR_PREFIX[f.kind];
  for (const [k, v] of Object.entries(f.attrs)) {
    const attr = `${p}/${k}`;
    if (Array.isArray(v)) for (const x of v) out.push([attr, x]);
    else out.push([attr, KEYWORD_ATTRS.has(k) ? { kw: String(v) } : v]);
  }
  return out;
}

const MULTI = new Set(["event/with"]);

function groupFacts(rows: [string, string, unknown][]): Fact[] {
  const byE = new Map<string, Map<string, unknown[]>>();
  for (const [e, a, v] of rows) {
    let m = byE.get(e);
    if (!m) byE.set(e, (m = new Map()));
    const list = m.get(a) ?? [];
    list.push(v);
    m.set(a, list);
  }
  const out: Fact[] = [];
  for (const m of byE.values()) {
    const one = (a: string) => {
      const v = m.get(a)?.[0];
      return typeof v === "string" ? v : undefined;
    };
    const id = one(":fact/id");
    const kind = KIND_OF_NS[id?.split(":")[0] ?? ""];
    if (!id || !kind) continue;
    const attrs: Fact["attrs"] = {};
    const p = `:${ATTR_PREFIX[kind]}/`;
    for (const [a, vs] of m) {
      if (!a.startsWith(p)) continue;
      const k = a.slice(p.length);
      const norm = vs.map((v) => (KEYWORD_DATOMS.has(a) && typeof v === "string" ? v.slice(1) : v)) as Array<string | boolean>;
      attrs[k] = MULTI.has(a.slice(1)) ? (norm as string[]).sort() : norm[0]!;
    }
    const validTo = one(":fact/valid-to");
    out.push({
      id,
      kind,
      subject: one(":fact/subject") ?? "",
      text: one(":fact/text") ?? "",
      source: one(":fact/source") ?? "",
      stated_at: one(":fact/stated-at") ?? "",
      confidence: one(":fact/confidence") === ":inferred" ? "inferred" : "stated",
      valid_from: one(":fact/valid-from") ?? "",
      ...(validTo ? { valid_to: validTo } : {}),
      attrs,
    });
  }
  return out;
}

/** Fact as one line for tools and the brief. */
export function factLine(f: Fact): string {
  const window = `${f.valid_from}${f.valid_to ? ` → ${f.valid_to}` : " → open"}`;
  return `${f.id} (${f.kind}) ${f.text} [${window}; source ${f.source}]`;
}
