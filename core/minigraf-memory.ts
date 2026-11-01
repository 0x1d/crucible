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

const attributes = new Set([
  "description",
  "rationale",
  "depends_on",
  "motivated_by",
  "source_session",
]);
const edges = new Set(["depends_on", "motivated_by"]);
const entityPattern =
  /^(decision|preference|constraint|dependency)\/[a-z0-9][a-z0-9_-]*$/;
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
};

export function openGraph(file: string): Graph {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new MiniGrafDb(file);
  const graph: Graph = {
    path: file,
    db,
    tx: readTx(file),
    idents: new Map(),
    entities: new Set(),
  };
  try {
    loadIdents(graph);
    replayRules(graph);
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
  for (const rule of rules) storeRule(graph, rule);
  if (facts.length === 0) {
    return { tx: graph.tx, at: new Date().toISOString(), reason, count: 0 };
  }
  const written = writeFacts(graph, facts, reason);
  return { tx: written.tx, at: written.at, reason, count: facts.length };
}

export function retract(graph: Graph, args: unknown): Record<string, unknown> {
  const record = recordOf(args);
  const reason = parseReason(record);
  const facts = parseFacts(record, false);
  requireCurrent(graph, facts);
  const body = facts.map((fact) => triple(fact)).join(" ");
  const written = commit(graph, `(retract [${body}])`);
  recordReasons(graph, facts, reason);
  return { tx: written.tx, at: written.at, reason, count: facts.length };
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
    "[?e :alchemist/ident ?id]",
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

function writeFacts(
  graph: Graph,
  facts: Fact[],
  reason: string,
): { tx: number; at: string } {
  let last: { tx: number; at: string } | null = null;
  for (const batch of batchesOf(facts)) {
    const timed = batch.some((fact) => fact.validFrom || fact.validTo);
    const triples = batch.map((fact) => triple(fact));
    if (!timed) appendMeta(graph, triples, batch, reason);
    last = commit(graph, transactForm(triples, timed ? batch[0] : null));
    if (timed) recordReasons(graph, batch, reason);
  }
  if (!last) throw new MemoryError("facts must be a non-empty list");
  return last;
}

function recordReasons(graph: Graph, facts: Fact[], reason: string): void {
  const triples: string[] = [];
  appendMeta(graph, triples, facts, reason);
  if (triples.length === 0) return;
  commit(graph, `(transact [${triples.join(" ")}])`);
  loadIdents(graph);
}

function appendMeta(
  graph: Graph,
  triples: string[],
  facts: Fact[],
  reason: string,
): void {
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.e)) continue;
    seen.add(fact.e);
    if (!graph.entities.has(fact.e)) {
      triples.push(`[:${fact.e} :alchemist/ident ${ednString(fact.e)}]`);
      graph.entities.add(fact.e);
    }
    triples.push(`[:${fact.e} :alchemist/reason ${ednString(reason)}]`);
  }
}

function transactForm(triples: string[], timed: Fact | null): string {
  const options: string[] = [];
  if (timed?.validFrom) options.push(`:valid-from ${ednString(timed.validFrom)}`);
  if (timed?.validTo) options.push(`:valid-to ${ednString(timed.validTo)}`);
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

function commit(graph: Graph, datalog: string): { tx: number; at: string } {
  const tx = graph.tx + 1;
  writeTx(graph.path, tx);
  graph.tx = tx;
  const parsed = execute(graph, datalog) as {
    transacted?: number;
    retracted?: number;
  };
  graph.db.checkpoint();
  loadIdents(graph);
  return { tx, at: stamp(parsed) };
}

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
    "(query [:find ?e ?id :valid-at :any-valid-time :where [?e :alchemist/ident ?id]])",
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
    "(query [:find ?id :valid-at :any-valid-time :where [?e :alchemist/ident ?id] [?e :description ?v]])",
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

function storeRule(graph: Graph, rule: string): void {
  const id = graph.tx + 1;
  commit(
    graph,
    `(transact [[:alchemist/rule-${id} :seq ${id}] [:alchemist/rule-${id} :text ${ednString(rule)}]])`,
  );
  execute(graph, rule);
}

function replayRules(graph: Graph): void {
  const parsed = readQuery(
    graph,
    "(query [:find ?n ?v :valid-at :any-valid-time :where [?e :seq ?n] [?e :text ?v]])",
  );
  const rules = parsed.results
    .flatMap((row) => {
      const order = row[0];
      const rule = row[1];
      return typeof order === "number" && typeof rule === "string" ? [{ order, rule }] : [];
    })
    .sort((left, right) => left.order - right.order);
  for (const rule of rules) execute(graph, rule.rule);
}

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
    throw new MemoryError("unknown entity");
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

function parseEntity(value: unknown): string {
  if (typeof value !== "string" || !entityPattern.test(value)) {
    throw new MemoryError("unknown entity");
  }
  return value;
}

function parseAttribute(value: unknown): string {
  if (typeof value !== "string" || !attributes.has(value)) {
    throw new MemoryError("unknown attribute");
  }
  return value;
}

function parseValue(value: unknown, attribute: string): string {
  if (typeof value !== "string" || value === "") {
    throw new MemoryError("value must be a string");
  }
  if ([...value].length > maxValue) throw new MemoryError("value is too long");
  if (edges.has(attribute) && !entityPattern.test(value)) {
    throw new MemoryError("value must be an entity");
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
    if (clause === null || typeof clause !== "object" || Array.isArray(clause)) {
      throw new MemoryError("unknown entity");
    }
    const row = clause as Record<string, unknown>;
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
    if (!variablePattern.test(value)) throw new MemoryError("unbound find variable");
    return value;
  }
  if (kind === "entity") return `:${parseEntity(value)}`;
  if (kind === "attribute") return `:${parseAttribute(value)}`;
  if (typeof value !== "string" || value === "") {
    throw new MemoryError("value must be a string");
  }
  if (
    (edges.has(attribute) || variablePattern.test(attribute)) &&
    entityPattern.test(value)
  ) {
    return `:${value}`;
  }
  if (edges.has(attribute)) throw new MemoryError("value must be an entity");
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
    if (typeof name !== "string") throw new MemoryError("unbound find variable");
    const bare = name.startsWith("?") ? name.slice(1) : name;
    if (!namePattern.test(bare) || !known.has(bare)) {
      throw new MemoryError("unbound find variable");
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
