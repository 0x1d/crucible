import fs from "node:fs";
import path from "node:path";
import { MiniGrafDb } from "minigraf";

const maxReason = 2000;
const maxValue = 4000;
const maxFacts = 100;
const maxRules = 20;
const maxRule = 4000;
const maxDatalog = 8000;
const maxRows = 200;
const defaultOverviewLimit = 20;
const maxOverviewLimit = 50;
const overviewPrefixes = new Set([
  "decision/",
  "preference/",
  "constraint/",
  "dependency/",
]);

// MiniGraf reports an open-ended valid-to as i64::MAX, which JSON.parse
// rounds; anything above this threshold means "no end".
const foreverThreshold = 9e18;
// An omitted valid_from means "no start". MiniGraf would otherwise default
// it to the transaction time, which turns a past valid_to into an empty window.
const epochStart = "1970-01-01T00:00:00.000Z";
// Bound on the open-time counter reconciliation walk.
const maxReconcileSteps = 10_000;

const retractModes = new Set(["close", "correct"]);

// Attribute names follow the temporal_reasoning SKILL.md convention: flat
// (no namespace) and hyphenated, e.g. `:depends-on`.
const attributes = new Set([
  "description",
  "rationale",
  "depends-on",
  "motivated-by",
  "governs",
  "supersedes",
  "source-session",
]);
const edges = new Set([
  "depends-on",
  "motivated-by",
  "governs",
  "supersedes",
]);
// System attributes: written by the binding with every entity, readable in
// queries, never writable by callers.
// - `:ident` maps MiniGraf's internal entity id back to the entity id.
// - `:entity-type` is `:type/<prefix>`, derived from the entity id.
const identAttribute = "ident";
const typeAttribute = "entity-type";
const systemAttributes = new Set([identAttribute, typeAttribute]);
const entityPrefixes = new Set(["decision", "preference", "constraint", "dependency"]);
const entityPattern =
  /^(decision|preference|constraint|dependency)\/[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;
const typePattern = /^type\/(decision|preference|constraint|dependency)$/;
const variablePattern = /^\?[a-z][a-z0-9_]*$/;
const namePattern = /^[a-z][a-z0-9_]*$/;
const keywordCell = /^:[a-zA-Z][a-zA-Z0-9_./-]*$/;
const uuidCell =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

type Fact = {
  e: string;
  a: string;
  v: string;
  validFrom: string | null;
  validTo: string | null;
};

type Window = { from: string | null; to: string | null };

type QueryResult = {
  results: unknown[][];
  variables: string[];
};

export type Graph = {
  path: string;
  db: MiniGrafDb;
  tx: number;
  idents: Map<string, string>;
  entities: Set<string>;
  skippedRules: string[];
};

export function openGraph(file: string): Graph {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new MiniGrafDb(file);
  const graph: Graph = {
    path: file,
    db,
    tx: 0,
    idents: new Map(),
    entities: new Set(),
    skippedRules: [],
  };
  try {
    loadIdents(graph);
    replayRules(graph);
    const stored = readTx(file);
    graph.tx = reconcileTx(graph, stored);
    if (graph.tx !== stored) writeTx(file, graph.tx);
  } catch (error) {
    db.close();
    throw error;
  }
  return graph;
}

export function closeGraph(graph: Graph): void {
  graph.db.checkpoint();
  graph.db.close();
}

export function transact(graph: Graph, args: unknown): Record<string, unknown> {
  const record = recordOf(args);
  const reason = parseReason(record);
  const rules = parseRules(record);
  const facts = parseFacts(record, rules.length > 0);
  if (facts.length > 0) {
    requireDescriptions(graph, facts);
    rejectCurrent(graph, facts);
  }
  // Register every rule before anything is stored: a rule MiniGraf rejects
  // must never reach the graph, or every later open would replay it.
  for (const rule of rules) execute(graph, rule);
  for (const rule of rules) storeRule(graph, rule);
  if (facts.length === 0) {
    return { tx: graph.tx, at: new Date().toISOString(), reason, count: 0 };
  }
  const written = writeFacts(graph, facts);
  return {
    tx: written.tx,
    at: written.at,
    reason,
    count: facts.length,
    // Canonical ids, so callers see what an input like "decision/Redis Cache"
    // was stored as.
    entities: [...new Set(facts.map((fact) => fact.e))].sort(),
  };
}

export function retract(graph: Graph, args: unknown): Record<string, unknown> {
  const record = recordOf(args);
  const reason = parseReason(record);
  const mode = parseMode(record);
  const facts = parseFacts(record, false);
  if (mode === "correct") return correctFacts(graph, record, facts, reason);
  return closeFacts(graph, record, facts, reason);
}

export function query(graph: Graph, args: unknown): Record<string, unknown> {
  const record = recordOf(args);
  parseHistory(record);
  const datalog = parseDatalog(record);
  if (datalog !== null && record.where !== undefined && record.where !== null) {
    throw new MemoryError("query accepts where or datalog");
  }
  if (datalog !== null) return runDatalog(graph, datalog);
  return runPattern(graph, record);
}

export function dispatch(
  graph: Graph,
  op: string,
  args: unknown,
): Record<string, unknown> {
  switch (op) {
    case "transact":
      return transact(graph, args);
    case "retract":
      return retract(graph, args);
    case "query":
      return query(graph, args);
    case "overview":
      return overview(graph, args);
    default:
      throw new MemoryError("unknown memory op");
  }
}

export function overview(graph: Graph, args: unknown): Record<string, unknown> {
  const record = recordOf(args);
  parseHistory(record);
  const prefix = parseOverviewPrefix(record);
  const limit = parseOverviewLimit(record);
  const asOf = parseAsOf(record);
  const validAt = parseValidAt(record);
  const sections = [":find", "?id"];
  if (asOf) sections.push(":as-of", asOf.edn);
  sections.push(":valid-at", validAt.edn);
  sections.push(
    ":where",
    `[?e :${identAttribute} ?id]`,
    "[?e :description ?v]",
    ":max-results",
    String(maxRows + 1),
  );
  const parsed = readQuery(graph, `(query [${sections.join(" ")}])`);
  const ids = new Set<string>();
  for (const row of parsed.results) {
    const entity = present(row[0], graph);
    if (typeof entity !== "string") continue;
    if (prefix && !entity.startsWith(prefix)) continue;
    ids.add(entity);
  }
  const entities = [...ids].sort();
  const truncated = entities.length > limit;
  const kept = entities.slice(0, limit);
  return {
    entities: kept,
    count: kept.length,
    truncated,
    limit,
    as_of: asOf ? asOf.echo : null,
    valid_at: validAt.echo,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function writeFacts(graph: Graph, facts: Fact[]): { tx: number; at: string } {
  // Timed idents go first, in their own transactions, so any as_of that sees
  // a fact also sees the ident that names its entity.
  const untimed = ensureTimedIdents(graph, facts);
  let last: { tx: number; at: string } | null = null;
  for (const batch of batchesOf(facts)) {
    const timed = batch.some((fact) => fact.validFrom || fact.validTo);
    const triples = batch.map((fact) => triple(fact));
    if (!timed) {
      for (const entity of new Set(batch.map((fact) => fact.e))) {
        if (untimed.delete(entity)) triples.push(...identTriples(entity));
      }
    }
    last = commit(graph, transactForm(triples, timed ? windowOf(batch[0]) : null));
  }
  if (!last) throw new MemoryError("facts must be a non-empty list");
  return last;
}

/**
 * Make sure every entity has an `:ident` (and `:entity-type`) that is valid wherever its
 * new facts are valid. Idents are open-ended, so one that starts at or before
 * the fact's valid_from covers the whole fact window.
 *
 * Timed facts get their ident written here, starting at the fact's
 * valid_from. Entities whose facts are untimed (valid from now) are returned
 * so the ident can ride in the same transaction as those facts.
 */
function ensureTimedIdents(graph: Graph, facts: Fact[]): Set<string> {
  const untimed = new Set<string>();
  const byStart = new Map<string, Set<string>>();
  for (const fact of facts) {
    const timed = Boolean(fact.validFrom || fact.validTo);
    if (!timed) {
      if (!identVisibleAt(graph, fact.e, null)) untimed.add(fact.e);
      continue;
    }
    const start = fact.validFrom ?? epochStart;
    if (identVisibleAt(graph, fact.e, start)) continue;
    const group = byStart.get(start) ?? new Set<string>();
    group.add(fact.e);
    byStart.set(start, group);
  }
  for (const [start, entities] of byStart) {
    const triples = [...entities].flatMap((entity) => identTriples(entity));
    commit(graph, transactForm(triples, { from: start, to: null }));
    for (const entity of entities) untimed.delete(entity);
  }
  return untimed;
}

function identVisibleAt(graph: Graph, entity: string, instant: string | null): boolean {
  const section = instant ? `:valid-at ${ednString(instant)}` : "";
  const parsed = readQuery(
    graph,
    `(query [:find ?id ${section} :where [:${entity} :${identAttribute} ?id]])`,
  );
  return parsed.results.length > 0;
}

/** The system facts every entity carries: its ident and its entity type. */
function identTriples(entity: string): string[] {
  const prefix = entity.slice(0, entity.indexOf("/"));
  return [
    `[:${entity} :${identAttribute} ${ednString(entity)}]`,
    `[:${entity} :${typeAttribute} :type/${prefix}]`,
  ];
}

function windowOf(fact: Fact): Window {
  return { from: fact.validFrom, to: fact.validTo };
}

function transactForm(triples: string[], window: Window | null): string {
  const options: string[] = [];
  const from = window?.from ?? (window?.to ? epochStart : null);
  if (from) options.push(`:valid-from ${ednString(from)}`);
  if (window?.to) options.push(`:valid-to ${ednString(window.to)}`);
  const prefix = options.length > 0 ? `{${options.join(" ")}} ` : "";
  return `(transact ${prefix}[${triples.join(" ")}])`;
}

function triple(fact: Fact): string {
  return `[:${fact.e} :${fact.a} ${valueEdn(fact)}]`;
}

function valueEdn(fact: Fact): string {
  if (edges.has(fact.a)) return `:${fact.v}`;
  return ednString(fact.v);
}

function batchesOf(facts: Fact[]): Fact[][] {
  const batches: Fact[][] = [];
  for (const fact of facts) {
    const batch = batches.find(
      (candidate) =>
        candidate[0].validFrom === fact.validFrom &&
        candidate[0].validTo === fact.validTo &&
        candidate.every((item) => item.e !== fact.e || item.a !== fact.a),
    );
    if (batch) batch.push(fact);
    else batches.push([fact]);
  }
  return batches;
}

/**
 * Run one MiniGraf write and advance the transaction counter only once
 * MiniGraf has accepted it. MiniGraf counts successful transact/retract
 * calls; a failed write consumes no number, so neither may the sidecar.
 */
function commit(graph: Graph, datalog: string): { tx: number; at: string } {
  const parsed = execute(graph, datalog) as {
    transacted?: number;
    retracted?: number;
  };
  const tx = graph.tx + 1;
  graph.tx = tx;
  writeTx(graph.path, tx);
  graph.db.checkpoint();
  loadIdents(graph);
  return { tx, at: stamp(parsed) };
}

// ---------------------------------------------------------------------------
// Retract
// ---------------------------------------------------------------------------

/**
 * mode "correct": the fact was recorded in error. MiniGraf's own retract
 * withdraws it across all valid time; only an earlier as_of still shows it.
 */
function correctFacts(
  graph: Graph,
  record: Record<string, unknown>,
  facts: Fact[],
  reason: string,
): Record<string, unknown> {
  if (record.valid_at !== undefined && record.valid_at !== null) {
    throw new MemoryError("mode correct takes no valid_at");
  }
  requireCurrent(graph, facts);
  const body = facts.map((fact) => triple(fact)).join(" ");
  const written = commit(graph, `(retract [${body}])`);
  return {
    tx: written.tx,
    at: written.at,
    reason,
    count: facts.length,
    mode: "correct",
  };
}

type ClosePlan = {
  fact: Fact;
  from: number;
  to: number;
  others: Array<[number, number]>;
};

/**
 * mode "close" (default): the fact stopped being true. Its live window is
 * ended at valid_at (default now), so valid_at queries inside the window
 * still find it.
 *
 * MiniGraf's retract removes every asserted window of a triple, so the
 * triple is retracted, every other window is written back verbatim, and the
 * closed window is written last. Each window is its own transaction: two
 * windows of one attribute in one transaction collapse.
 *
 * Every fact is checked before anything is written.
 */
function closeFacts(
  graph: Graph,
  record: Record<string, unknown>,
  facts: Fact[],
  reason: string,
): Record<string, unknown> {
  const now = Date.now();
  const end = parseCloseAt(record, now);
  const plans: ClosePlan[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (fact.validFrom || fact.validTo) {
      throw new MemoryError(
        "close takes e, a, v only; pass valid_at for the end, or use mode correct",
      );
    }
    const key = triple(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(planClose(graph, fact, end, now));
  }
  let last: { tx: number; at: string } | null = null;
  for (const plan of plans) {
    const body = triple(plan.fact);
    commit(graph, `(retract [${body}])`);
    for (const [from, to] of plan.others) {
      commit(graph, transactForm([body], windowFromMs(from, to)));
    }
    last = commit(graph, transactForm([body], windowFromMs(plan.from, plan.to)));
  }
  if (!last) throw new MemoryError("facts must be a non-empty list");
  // A fact closed in the millisecond it was asserted keeps a window of
  // [from, from + 1), which a query in that millisecond still matches. With a
  // default end the wait is at most 1 ms, and the fact is gone on return.
  if (end === null) {
    const closedAt = Math.max(...plans.map((plan) => plan.to));
    while (Date.now() < closedAt);
  }
  return {
    tx: last.tx,
    at: last.at,
    reason,
    count: facts.length,
    mode: "close",
    closed: plans.map((plan) => ({
      e: plan.fact.e,
      a: plan.fact.a,
      v: plan.fact.v,
      valid_from: new Date(plan.from).toISOString(),
      valid_to: new Date(plan.to).toISOString(),
    })),
  };
}

function planClose(graph: Graph, fact: Fact, end: number | null, now: number): ClosePlan {
  const windows = assertedWindows(graph, fact);
  const live = windows.filter(([from, to]) => to >= foreverThreshold && from <= now);
  if (live.length === 0) throw new MemoryError("fact is not current");
  const from = Math.min(...live.map(([start]) => start));
  let to: number;
  if (end === null) {
    to = now > from ? now : from + 1;
  } else if (end <= from) {
    throw new MemoryError("valid_at must be after the fact's valid_from");
  } else {
    to = end;
  }
  const others = windows.filter(
    ([start, stop]) => !(stop >= foreverThreshold && start <= now),
  );
  return { fact, from, to, others };
}

function assertedWindows(graph: Graph, fact: Fact): Array<[number, number]> {
  const parsed = readQuery(
    graph,
    `(query [:find ?vf ?vt :valid-at :any-valid-time :where ${triple(fact)} ` +
      `[:${fact.e} :db/valid-from ?vf] [:${fact.e} :db/valid-to ?vt]])`,
  );
  const windows: Array<[number, number]> = [];
  for (const row of parsed.results) {
    if (typeof row[0] === "number" && typeof row[1] === "number") {
      windows.push([row[0], row[1]]);
    }
  }
  return windows.sort((left, right) => left[0] - right[0]);
}

function windowFromMs(from: number, to: number): Window {
  return {
    from: new Date(from).toISOString(),
    to: to >= foreverThreshold ? null : new Date(to).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Transaction counter
// ---------------------------------------------------------------------------

/**
 * Bring the stored counter in line with MiniGraf's own transaction count.
 *
 * Every successful write changes the full fact dump: an assert adds a row
 * with a new tx-count, a retract removes rows. So the true count T is the
 * smallest N whose as_of view equals the latest view, with as_of N-1
 * different. Walk up from the stored value until the view matches (a lost
 * bump), then down while the previous view still matches (a counter that
 * ran ahead of MiniGraf).
 */
function reconcileTx(graph: Graph, stored: number): number {
  const latest = snapshot(graph, null);
  let candidate = stored;
  let steps = 0;
  while (snapshot(graph, candidate) !== latest) {
    candidate += 1;
    if (++steps > maxReconcileSteps) return stored;
  }
  while (candidate > 0 && snapshot(graph, candidate - 1) === latest) {
    candidate -= 1;
    if (++steps > maxReconcileSteps) return stored;
  }
  return candidate;
}

function snapshot(graph: Graph, asOf: number | null): string {
  const section = asOf === null ? "" : `:as-of ${asOf}`;
  const parsed = readQuery(
    graph,
    `(query [:find ?e ?a ?v ?tx ${section} :valid-at :any-valid-time ` +
      ":where [?e ?a ?v] [?e :db/tx-count ?tx]])",
  );
  return parsed.results
    .map((row) => JSON.stringify(row))
    .sort()
    .join("\n");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function execute(graph: Graph, datalog: string): unknown {
  try {
    return JSON.parse(graph.db.execute(datalog)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory request failed";
    throw new MemoryError(message);
  }
}

function readQuery(graph: Graph, datalog: string): QueryResult {
  const parsed = execute(graph, datalog) as QueryResult;
  return {
    results: Array.isArray(parsed.results) ? parsed.results : [],
    variables: Array.isArray(parsed.variables) ? parsed.variables : [],
  };
}

function loadIdents(graph: Graph): void {
  const parsed = readQuery(
    graph,
    `(query [:find ?e ?id :valid-at :any-valid-time :where [?e :${identAttribute} ?id]])`,
  );
  graph.idents.clear();
  graph.entities.clear();
  for (const row of parsed.results) {
    const uuid = row[0];
    const id = row[1];
    if (typeof uuid === "string" && typeof id === "string") {
      graph.idents.set(uuid, id);
      graph.entities.add(id);
    }
  }
}

function runDatalog(graph: Graph, datalog: string): Record<string, unknown> {
  const parsed = readQuery(graph, datalog);
  return {
    results: parsed.results.map((row) => row.map((cell) => present(cell, graph))),
    variables: parsed.variables,
  };
}

function runPattern(
  graph: Graph,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const asOf = parseAsOf(record);
  const validAt = parseValidAt(record);
  const clauses = parseWhere(record);
  const find = parseFind(record, clauses);
  const findVars = find.map((name) => `?${name}`);
  const where = clauses.map((clause) => `[${clause.e} ${clause.a} ${clause.v}]`);
  const sections = [":find", ...findVars];
  if (asOf) sections.push(":as-of", asOf.edn);
  sections.push(":valid-at", validAt.edn);
  sections.push(":where", ...where, ":max-results", String(maxRows + 1));
  const parsed = readQuery(graph, `(query [${sections.join(" ")}])`);
  const indexes = new Map(
    parsed.variables.map((variable, index) => [variable.replace(/^\?/, ""), index]),
  );
  const rows = parsed.results.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const name of find) {
      const index = indexes.get(name);
      mapped[name] = present(index === undefined ? null : row[index], graph);
    }
    return mapped;
  });
  rows.sort((left, right) => {
    for (const name of find) {
      const cmp = compare(left[name], right[name]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  const unique: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  const truncated = unique.length > maxRows;
  const kept = unique.slice(0, maxRows);
  return {
    rows: kept,
    count: kept.length,
    truncated,
    as_of: asOf ? asOf.echo : null,
    valid_at: validAt.echo,
  };
}

function requireDescriptions(graph: Graph, facts: Fact[]): void {
  const described = describedEntities(graph);
  for (const fact of facts) {
    if (fact.a === "description") described.add(fact.e);
  }
  for (const fact of facts) {
    if (!described.has(fact.e)) throw new MemoryError("description is required");
  }
}

function rejectCurrent(graph: Graph, facts: Fact[]): void {
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = identity(fact);
    if (seen.has(key) || factVisible(graph, fact)) {
      throw new MemoryError("fact is already current");
    }
    seen.add(key);
  }
}

function describedEntities(graph: Graph): Set<string> {
  const parsed = readQuery(
    graph,
    `(query [:find ?id :valid-at :any-valid-time :where [?e :${identAttribute} ?id] [?e :description ?v]])`,
  );
  const described = new Set<string>();
  for (const row of parsed.results) {
    const id = present(row[0], graph);
    if (typeof id === "string") described.add(id);
  }
  return described;
}

function requireCurrent(graph: Graph, facts: Fact[]): void {
  for (const fact of facts) {
    if (!factVisible(graph, fact)) throw new MemoryError("fact is not current");
  }
}

function factVisible(graph: Graph, fact: Fact): boolean {
  const when = probeValidAt(fact);
  const section = when ? `:valid-at ${when}` : "";
  const parsed = readQuery(
    graph,
    `(query [:find ?v ${section} :where [:${fact.e} :${fact.a} ?v]])`,
  );
  return parsed.results.some((row) => present(row[0], graph) === fact.v);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Persist a rule that MiniGraf has already accepted in this session. */
function storeRule(graph: Graph, rule: string): void {
  const id = graph.tx + 1;
  commit(
    graph,
    `(transact [[:alchemist/rule-${id} :alchemist/rule-seq ${id}] ` +
      `[:alchemist/rule-${id} :alchemist/rule-text ${ednString(rule)}]])`,
  );
}

/**
 * Re-register stored rules on open. A stored rule that MiniGraf now rejects
 * is skipped and reported on stderr instead of failing the open; a single bad
 * rule must not take memory down.
 */
function replayRules(graph: Graph): void {
  const rows = [
    // Current attribute names, then the pre-namespace ones for older graphs.
    ...readQuery(
      graph,
      "(query [:find ?n ?v :valid-at :any-valid-time :where [?e :alchemist/rule-seq ?n] [?e :alchemist/rule-text ?v]])",
    ).results,
    ...readQuery(
      graph,
      "(query [:find ?n ?v :valid-at :any-valid-time :where [?e :seq ?n] [?e :text ?v]])",
    ).results,
  ];
  const rules = rows
    .flatMap((row) => {
      const order = row[0];
      const rule = row[1];
      return typeof order === "number" && typeof rule === "string" ? [{ order, rule }] : [];
    })
    .sort((left, right) => left.order - right.order);
  for (const rule of rules) {
    try {
      execute(graph, rule.rule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      graph.skippedRules.push(rule.rule);
      process.stderr.write(`[memory] skipped stored rule ${rule.order}: ${message}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function probeValidAt(fact: Fact): string {
  if (fact.validFrom) return ednString(fact.validFrom);
  if (fact.validTo) {
    const earlier = new Date(Date.parse(fact.validTo) - 1000).toISOString();
    return ednString(earlier);
  }
  return "";
}

function identity(fact: Fact): string {
  return [fact.e, fact.a, fact.v, fact.validFrom ?? "", fact.validTo ?? ""].join(
    "\0",
  );
}

function present(value: unknown, graph: Graph): unknown {
  if (typeof value !== "string") return value;
  const ident = graph.idents.get(value);
  if (ident) return ident;
  if (uuidCell.test(value)) return value;
  if (keywordCell.test(value)) return value.slice(1);
  return value;
}

function parseReason(record: Record<string, unknown>): string {
  const reason = record.reason;
  if (typeof reason !== "string") throw new MemoryError("reason is required");
  const trimmed = reason.trim();
  if (trimmed === "") throw new MemoryError("reason is required");
  if ([...trimmed].length > maxReason) throw new MemoryError("reason is too long");
  return trimmed;
}

function parseMode(record: Record<string, unknown>): "close" | "correct" {
  if (record.mode === undefined || record.mode === null) return "close";
  if (typeof record.mode !== "string" || !retractModes.has(record.mode)) {
    throw new MemoryError("mode must be close or correct");
  }
  return record.mode as "close" | "correct";
}

function parseCloseAt(record: Record<string, unknown>, now: number): number | null {
  if (record.valid_at === undefined || record.valid_at === null) return null;
  if (typeof record.valid_at !== "string") throw new MemoryError("invalid timestamp");
  const parsed = parseTimestamp(record.valid_at);
  if (!parsed) throw new MemoryError("invalid timestamp");
  const ms = Date.parse(parsed);
  if (ms > now) throw new MemoryError("valid_at must not be in the future");
  return ms;
}

function parseOverviewPrefix(record: Record<string, unknown>): string | null {
  if (record.prefix === undefined || record.prefix === null) return null;
  if (typeof record.prefix !== "string" || !overviewPrefixes.has(record.prefix)) {
    throw new MemoryError("unknown prefix");
  }
  return record.prefix;
}

function parseOverviewLimit(record: Record<string, unknown>): number {
  const raw = record.limit;
  if (raw === undefined || raw === null) return defaultOverviewLimit;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new MemoryError("limit must be an integer");
  }
  if (raw < 1 || raw > maxOverviewLimit) {
    throw new MemoryError(`limit must be between 1 and ${maxOverviewLimit}`);
  }
  return raw;
}

function parseRules(record: Record<string, unknown>): string[] {
  if (record.rules === undefined || record.rules === null) return [];
  if (!Array.isArray(record.rules)) throw new MemoryError("rules must be a list");
  if (record.rules.length > maxRules) throw new MemoryError("too many rules");
  return record.rules.map((rule) => {
    if (typeof rule !== "string" || !oneForm(rule, "(rule")) {
      throw new MemoryError("rule must be a MiniGraf rule");
    }
    const trimmed = rule.trim();
    if ([...trimmed].length > maxRule) throw new MemoryError("rule is too long");
    return trimmed;
  });
}

function parseFacts(record: Record<string, unknown>, optional: boolean): Fact[] {
  if (record.facts === undefined || record.facts === null) {
    if (optional) return [];
    throw new MemoryError("facts must be a non-empty list");
  }
  if (!Array.isArray(record.facts) || record.facts.length === 0) {
    throw new MemoryError("facts must be a non-empty list");
  }
  if (record.facts.length > maxFacts) throw new MemoryError("too many facts");
  return record.facts.map((fact) => parseFact(fact));
}

function parseFact(fact: unknown): Fact {
  if (fact === null || typeof fact !== "object" || Array.isArray(fact)) {
    throw new MemoryError(
      'fact must be an object like {"e": "decision/x", "a": "description", "v": "..."}',
    );
  }
  const record = fact as Record<string, unknown>;
  const e = parseEntity(record.e);
  const a = parseAttribute(record.a);
  const v = parseValue(record.v, a);
  const validFrom = parseOptionalTime(record.valid_from);
  const validTo = parseOptionalTime(record.valid_to);
  if (validFrom && validTo && validFrom >= validTo) {
    throw new MemoryError("valid_from must be before valid_to");
  }
  return { e, a, v, validFrom, validTo };
}

const entityHint =
  "entity ids are <prefix>/<slug> with prefix decision, preference, constraint, or dependency; " +
  "the slug is lowercased, _ and - are kept, every other character becomes -, and leading/trailing - are stripped";
const attributeHint = `allowed attributes: ${[...attributes].join(", ")}`;

/**
 * Canonical entity id, per the temporal_reasoning SKILL.md rule: lowercase;
 * `_` and `-` are both preserved, every other character becomes `-`;
 * leading/trailing hyphens are stripped (underscores are not). Hyphen runs
 * are kept so distinct names never fold into one entity.
 * `decision/Redis_cache` → `decision/redis_cache`,
 * `dependency/pydantic.v2` → `dependency/pydantic-v2`.
 */
export function canonicalEntity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slash = value.indexOf("/");
  if (slash < 0) return null;
  const prefix = value.slice(0, slash).trim().toLowerCase();
  if (!entityPrefixes.has(prefix)) return null;
  const slug = value
    .slice(slash + 1)
    .toLowerCase()
    // `u`: one `-` per code point, matching the Elixir side.
    .replace(/[^a-z0-9_-]/gu, "-")
    .replace(/^-+|-+$/g, "");
  const id = `${prefix}/${slug}`;
  return entityPattern.test(id) ? id : null;
}

function parseEntity(value: unknown): string {
  const id = canonicalEntity(value);
  if (id === null) {
    throw new MemoryError(`unknown entity ${JSON.stringify(value ?? null)}; ${entityHint}`);
  }
  return id;
}

/**
 * Writable attributes only. `read` also admits the system attributes
 * (`ident`, `entity-type`) so queries can filter on them.
 */
function parseAttribute(value: unknown, read = false): string {
  if (typeof value === "string" && read && systemAttributes.has(value)) return value;
  if (typeof value === "string" && systemAttributes.has(value)) {
    throw new MemoryError(
      `attribute ${JSON.stringify(value)} is written automatically; ${attributeHint}`,
    );
  }
  if (typeof value !== "string" || !attributes.has(value)) {
    throw new MemoryError(
      `unknown attribute ${JSON.stringify(value ?? null)}; ${attributeHint}. ` +
        "Put free-form detail in description or rationale.",
    );
  }
  return value;
}

function parseValue(value: unknown, attribute: string): string {
  if (typeof value !== "string" || value === "") {
    throw new MemoryError("value must be a string");
  }
  if ([...value].length > maxValue) throw new MemoryError("value is too long");
  if (edges.has(attribute)) {
    const id = canonicalEntity(value);
    if (id === null) throw new MemoryError("value must be an entity");
    return id;
  }
  return value;
}

function parseOptionalTime(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new MemoryError("invalid timestamp");
  const parsed = parseTimestamp(value);
  if (!parsed) throw new MemoryError("invalid timestamp");
  return parsed;
}

function parseHistory(record: Record<string, unknown>): void {
  if (record.history === undefined || record.history === null) return;
  if (typeof record.history !== "boolean") {
    throw new MemoryError("history must be a boolean");
  }
  if (record.history) throw new MemoryError("history is not supported");
}

function parseDatalog(record: Record<string, unknown>): string | null {
  if (record.datalog === undefined || record.datalog === null) return null;
  if (typeof record.datalog !== "string" || !oneForm(record.datalog, "(query")) {
    throw new MemoryError("datalog must be a query");
  }
  const trimmed = record.datalog.trim();
  if ([...trimmed].length > maxDatalog) throw new MemoryError("datalog is too long");
  return trimmed;
}

function parseAsOf(
  record: Record<string, unknown>,
): { edn: string; echo: number | string } | null {
  if (record.as_of === undefined || record.as_of === null) return null;
  if (typeof record.as_of === "number" && Number.isInteger(record.as_of) && record.as_of >= 0) {
    return { edn: String(record.as_of), echo: record.as_of };
  }
  if (typeof record.as_of === "string") {
    const parsed = parseTimestamp(record.as_of);
    if (parsed) return { edn: ednString(parsed), echo: parsed };
  }
  throw new MemoryError("invalid as_of");
}

function parseValidAt(record: Record<string, unknown>): { edn: string; echo: string } {
  if (record.valid_at === undefined || record.valid_at === null) {
    const now = new Date().toISOString();
    return { edn: ednString(now), echo: now };
  }
  if (record.valid_at === "any") return { edn: ":any-valid-time", echo: "any" };
  if (typeof record.valid_at === "string") {
    const parsed = parseTimestamp(record.valid_at);
    if (parsed) return { edn: ednString(parsed), echo: parsed };
  }
  throw new MemoryError("invalid timestamp");
}

type Clause = { e: string; a: string; v: string };

function parseWhere(record: Record<string, unknown>): Clause[] {
  if (!Array.isArray(record.where) || record.where.length === 0) {
    throw new MemoryError("where must be a non-empty list");
  }
  return record.where.map((clause) => {
    // Accept both {e, a, v} objects and [e, a, v] tuples.
    let row: Record<string, unknown>;
    if (Array.isArray(clause) && clause.length === 3) {
      row = { e: clause[0], a: clause[1], v: clause[2] };
    } else if (clause !== null && typeof clause === "object" && !Array.isArray(clause)) {
      row = clause as Record<string, unknown>;
    } else {
      throw new MemoryError(
        'where clause must be {"e": ..., "a": ..., "v": ...} or [e, a, v]; use "?name" for variables',
      );
    }
    return {
      e: parsePattern(row.e, "entity"),
      a: parsePattern(row.a, "attribute"),
      v: parsePattern(row.v, "value", typeof row.a === "string" ? row.a : ""),
    };
  });
}

function parsePattern(
  value: unknown,
  kind: "entity" | "attribute" | "value",
  attribute = "",
): string {
  if (typeof value === "string" && value.startsWith("?")) {
    if (!variablePattern.test(value)) {
      throw new MemoryError(
        `invalid variable ${JSON.stringify(value)}; variables look like ?name (lowercase, digits, _)`,
      );
    }
    return value;
  }
  if (kind === "entity") return `:${parseEntity(value)}`;
  if (kind === "attribute") return `:${parseAttribute(value, true)}`;
  if (typeof value !== "string" || value === "") {
    throw new MemoryError("value must be a string");
  }
  if (attribute === typeAttribute) {
    if (!typePattern.test(value)) {
      throw new MemoryError(
        "entity-type value must be type/decision, type/preference, type/constraint, or type/dependency",
      );
    }
    return `:${value}`;
  }
  if (edges.has(attribute)) {
    const id = canonicalEntity(value);
    if (id === null) throw new MemoryError("value must be an entity");
    return `:${id}`;
  }
  // Unknown (variable) attribute: an exact entity or type id is a keyword.
  if (
    variablePattern.test(attribute) &&
    (entityPattern.test(value) || typePattern.test(value))
  ) {
    return `:${value}`;
  }
  return ednString(value);
}

function parseFind(record: Record<string, unknown>, clauses: Clause[]): string[] {
  if (!Array.isArray(record.find) || record.find.length === 0) {
    throw new MemoryError("find must be a non-empty list");
  }
  const known = new Set<string>();
  for (const clause of clauses) {
    for (const slot of [clause.e, clause.a, clause.v]) {
      if (variablePattern.test(slot)) known.add(slot.slice(1));
    }
  }
  const find: string[] = [];
  for (const name of record.find) {
    const bare = typeof name === "string" && name.startsWith("?") ? name.slice(1) : name;
    if (typeof bare !== "string" || !namePattern.test(bare) || !known.has(bare)) {
      const bound = [...known].map((v) => `?${v}`).join(", ") || "none";
      throw new MemoryError(
        `unbound find variable ${JSON.stringify(name)}; variables bound in where: ${bound}`,
      );
    }
    if (!find.includes(bare)) find.push(bare);
  }
  return find;
}

function parseTimestamp(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function oneForm(source: string, head: string): boolean {
  const text = source.trim();
  if (!text.startsWith(head)) return false;
  const next = text[head.length];
  if (next !== undefined && next !== " " && next !== "\n" && next !== "\t" && next !== "[") {
    return false;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i === text.length - 1;
      if (depth < 0) return false;
    }
  }
  return false;
}

function ednString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function stamp(parsed: { transacted?: number; retracted?: number }): string {
  const ms = parsed.transacted ?? parsed.retracted;
  if (typeof ms !== "number") throw new MemoryError("minigraf write returned no timestamp");
  return new Date(ms).toISOString();
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const a = String(left);
  const b = String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryError("memory request failed");
  }
  return value as Record<string, unknown>;
}

function readTx(file: string): number {
  const sidecar = `${file}.tx`;
  if (!fs.existsSync(sidecar)) return 0;
  const parsed = Number(fs.readFileSync(sidecar, "utf8"));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MemoryError("invalid memory tx counter");
  }
  return parsed;
}

function writeTx(file: string, tx: number): void {
  const sidecar = `${file}.tx`;
  const tmp = `${sidecar}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  fs.writeFileSync(fd, String(tx));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, sidecar);
}
