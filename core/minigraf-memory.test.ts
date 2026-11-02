import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeGraph,
  MemoryError,
  openGraph,
  overview,
  query,
  retract,
  transact,
  type Graph,
} from "./minigraf-memory.ts";

function fresh(): Graph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-mg-"));
  return openGraph(path.join(dir, "minigraf.graph"));
}

function message(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof MemoryError);
    return error.message;
  }
  assert.fail("expected MemoryError");
}

test("transact, retract, and as-of", () => {
  const graph = fresh();
  try {
    const written = transact(graph, {
      reason: "Initial choice",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    });
    assert.equal(written.tx, 1);

    const retracted = retract(graph, {
      reason: "Switching to CockroachDB",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    });
    // close = retract (tx 2) + re-transact of the closed window (tx 3)
    assert.equal(retracted.tx, 3);
    assert.equal(retracted.mode, "close");

    transact(graph, {
      reason: "Switching to CockroachDB",
      facts: [{ e: "decision/db", a: "description", v: "CockroachDB" }],
    });

    const earlier = query(graph, {
      as_of: 1,
      find: ["name"],
      where: [{ e: "decision/db", a: "description", v: "?name" }],
    });
    assert.deepEqual(earlier.rows, [{ name: "PostgreSQL" }]);

    const current = query(graph, {
      find: ["?name"],
      where: [{ e: "decision/db", a: "description", v: "?name" }],
    });
    assert.deepEqual(current.rows, [{ name: "CockroachDB" }]);

    const catalog = overview(graph, { prefix: "decision/", limit: 10 });
    assert.equal(catalog.count, 1);
    assert.deepEqual(catalog.entities, ["decision/db"]);
    assert.equal(catalog.as_of, null);

    const earlierCatalog = overview(graph, { as_of: 1, prefix: "decision/" });
    assert.deepEqual(earlierCatalog.entities, ["decision/db"]);
    assert.equal(earlierCatalog.as_of, 1);
  } finally {
    closeGraph(graph);
  }
});

test("overview prefixes, limits, and rejects bad args", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "seed",
      facts: [
        { e: "decision/one", a: "description", v: "first decision" },
        { e: "decision/two", a: "description", v: "second decision" },
        { e: "preference/ui", a: "description", v: "dark mode" },
      ],
    });
    const decisions = overview(graph, { prefix: "decision/" });
    assert.deepEqual(decisions.entities, ["decision/one", "decision/two"]);
    const limited = overview(graph, { limit: 1 });
    assert.equal(limited.count, 1);
    assert.equal(limited.truncated, true);
    assert.deepEqual(limited.entities, ["decision/one"]);
    assert.equal(message(() => overview(graph, { prefix: "topic/" })), "unknown prefix");
    assert.equal(message(() => overview(graph, { limit: 0 })), "limit must be between 1 and 50");
  } finally {
    closeGraph(graph);
  }
});

test("valid time hides a fact outside its window", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "employment",
      facts: [
        {
          e: "decision/job",
          a: "description",
          v: "TechCorp",
          valid_from: "2020-01-01",
          valid_to: "2023-06-01",
        },
      ],
    });
    const mid = query(graph, {
      valid_at: "2021-06-01",
      find: ["company"],
      where: [{ e: "decision/job", a: "description", v: "?company" }],
    });
    assert.deepEqual(mid.rows, [{ company: "TechCorp" }]);
    const now = query(graph, {
      find: ["company"],
      where: [{ e: "decision/job", a: "description", v: "?company" }],
    });
    assert.deepEqual(now.rows, []);
  } finally {
    closeGraph(graph);
  }
});

test("joins on edges and keeps two values of one attribute", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "link",
      facts: [
        { e: "decision/pay", a: "description", v: "use stripe" },
        { e: "decision/pay", a: "description", v: "card network" },
        { e: "dependency/stripe", a: "description", v: "stripe billing" },
        { e: "decision/pay", a: "motivated_by", v: "dependency/stripe" },
      ],
    });
    const joined = query(graph, {
      find: ["name"],
      where: [
        { e: "decision/pay", a: "motivated_by", v: "?dep" },
        { e: "?dep", a: "description", v: "?name" },
      ],
    });
    assert.deepEqual(joined.rows, [{ name: "stripe billing" }]);
    const both = query(graph, {
      find: ["v"],
      where: [{ e: "decision/pay", a: "description", v: "?v" }],
    });
    assert.deepEqual(both.rows, [{ v: "card network" }, { v: "use stripe" }]);
  } finally {
    closeGraph(graph);
  }
});

test("governs and supersedes are traversable edges", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "edges",
      facts: [
        { e: "constraint/ci", a: "description", v: "run checks" },
        { e: "dependency/tests", a: "description", v: "test suite" },
        { e: "decision/new", a: "description", v: "new choice" },
        { e: "decision/old", a: "description", v: "old choice" },
        { e: "constraint/ci", a: "governs", v: "dependency/tests" },
        { e: "decision/new", a: "supersedes", v: "decision/old" },
      ],
    });
    const governed = query(graph, {
      find: ["name"],
      where: [
        { e: "constraint/ci", a: "governs", v: "?d" },
        { e: "?d", a: "description", v: "?name" },
      ],
    });
    assert.deepEqual(governed.rows, [{ name: "test suite" }]);
    const replaced = query(graph, {
      find: ["name"],
      where: [
        { e: "decision/new", a: "supersedes", v: "?d" },
        { e: "?d", a: "description", v: "?name" },
      ],
    });
    assert.deepEqual(replaced.rows, [{ name: "old choice" }]);
    assert.throws(
      () =>
        transact(graph, {
          reason: "bad",
          facts: [{ e: "constraint/ci", a: "governs", v: "not an entity" }],
        }),
      /value must be an entity/,
    );
  } finally {
    closeGraph(graph);
  }
});

test("datalog rules, negation, and aggregates", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "graph",
      rules: [
        "(rule [(reachable ?a ?b) [?a :depends_on ?b]])",
        "(rule [(reachable ?a ?b) [?a :depends_on ?m] (reachable ?m ?b)])",
      ],
      facts: [
        { e: "dependency/a", a: "description", v: "alpha service" },
        { e: "dependency/b", a: "description", v: "beta service" },
        { e: "dependency/c", a: "description", v: "gamma service" },
        { e: "dependency/a", a: "depends_on", v: "dependency/b" },
        { e: "dependency/b", a: "depends_on", v: "dependency/c" },
      ],
    });
    const reached = query(graph, {
      datalog: "(query [:find ?b :where (reachable :dependency/a ?b)])",
    });
    assert.deepEqual(
      (reached.results as string[][]).map((row) => row[0]).sort(),
      ["dependency/b", "dependency/c"],
    );
    const counted = query(graph, {
      datalog: "(query [:find (count ?e) :where [?e :depends_on ?d]])",
    });
    assert.deepEqual(counted.results, [[2]]);
    const open = query(graph, {
      datalog:
        "(query [:find ?id :where [?e :alchemist/ident ?id] [?e :description ?v] (not [?e :depends_on :dependency/b])])",
    });
    const ids = (open.results as string[][]).map((row) => row[0]).sort();
    assert.deepEqual(ids, ["dependency/b", "dependency/c"]);
  } finally {
    closeGraph(graph);
  }
});

test("reopen keeps facts and rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-mg-"));
  const file = path.join(dir, "minigraf.graph");
  const first = openGraph(file);
  transact(first, {
    reason: "persist",
    rules: ["(rule [(named ?e ?v) [?e :description ?v]])"],
    facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
  });
  closeGraph(first);
  const second = openGraph(file);
  try {
    const rows = query(second, {
      datalog: "(query [:find ?v :where (named :decision/db ?v)])",
    });
    assert.deepEqual(rows.results, [["PostgreSQL"]]);
  } finally {
    closeGraph(second);
  }
});

test("rejects schema and duplicate writes", () => {
  const graph = fresh();
  try {
    assert.equal(
      message(() => transact(graph, { facts: [] })),
      "reason is required",
    );
    assert.equal(
      message(() =>
        transact(graph, {
          reason: "x",
          facts: [{ e: "nope", a: "description", v: "x" }],
        }),
      ),
      "unknown entity",
    );
    assert.equal(
      message(() =>
        transact(graph, {
          reason: "x",
          facts: [{ e: "decision/db", a: "rationale", v: "because" }],
        }),
      ),
      "description is required",
    );
    transact(graph, {
      reason: "once",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    });
    assert.equal(
      message(() =>
        transact(graph, {
          reason: "again",
          facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
        }),
      ),
      "fact is already current",
    );
    assert.equal(
      message(() =>
        retract(graph, {
          reason: "missing",
          facts: [{ e: "decision/db", a: "description", v: "missing" }],
        }),
      ),
      "fact is not current",
    );
    assert.equal(
      message(() => query(graph, { history: true, where: [], find: [] })),
      "history is not supported",
    );
    assert.equal(
      message(() => query(graph, { datalog: "(transact [[:a :b \"c\"]])" })),
      "datalog must be a query",
    );
  } finally {
    closeGraph(graph);
  }
});

function graphFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-mg-"));
  return path.join(dir, "minigraf.graph");
}

function descriptionsAt(graph: Graph, entity: string, validAt?: string): unknown[] {
  const result = query(graph, {
    ...(validAt ? { valid_at: validAt } : {}),
    find: ["v"],
    where: [{ e: entity, a: "description", v: "?v" }],
  });
  return (result.rows as Array<{ v: unknown }>).map((row) => row.v);
}

test("close retract keeps valid-time history", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "chosen in 2020",
      facts: [
        { e: "decision/db", a: "description", v: "PostgreSQL", valid_from: "2020-01-01" },
      ],
    });
    const closed = retract(graph, {
      reason: "replaced in 2024",
      valid_at: "2024-01-01",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    });
    assert.equal(closed.mode, "close");
    assert.deepEqual(closed.closed, [
      {
        e: "decision/db",
        a: "description",
        v: "PostgreSQL",
        valid_from: "2020-01-01T00:00:00.000Z",
        valid_to: "2024-01-01T00:00:00.000Z",
      },
    ]);
    transact(graph, {
      reason: "replaced in 2024",
      facts: [
        { e: "decision/db", a: "description", v: "CockroachDB", valid_from: "2024-01-01" },
      ],
    });
    assert.deepEqual(descriptionsAt(graph, "decision/db", "2022-01-01"), ["PostgreSQL"]);
    assert.deepEqual(descriptionsAt(graph, "decision/db"), ["CockroachDB"]);
  } finally {
    closeGraph(graph);
  }
});

test("close retract with default end keeps the fact under any valid time", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "seed",
      facts: [{ e: "decision/cache", a: "description", v: "Redis" }],
    });
    retract(graph, {
      reason: "dropped",
      facts: [{ e: "decision/cache", a: "description", v: "Redis" }],
    });
    assert.deepEqual(descriptionsAt(graph, "decision/cache"), []);
    assert.deepEqual(descriptionsAt(graph, "decision/cache", "any"), ["Redis"]);
  } finally {
    closeGraph(graph);
  }
});

test("close retract keeps the fact's other windows", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "first stint",
      facts: [
        {
          e: "decision/lang",
          a: "description",
          v: "Elixir",
          valid_from: "2010-01-01",
          valid_to: "2011-01-01",
        },
      ],
    });
    transact(graph, {
      reason: "second stint",
      facts: [{ e: "decision/lang", a: "description", v: "Elixir", valid_from: "2020-01-01" }],
    });
    retract(graph, {
      reason: "ended",
      valid_at: "2024-01-01",
      facts: [{ e: "decision/lang", a: "description", v: "Elixir" }],
    });
    assert.deepEqual(descriptionsAt(graph, "decision/lang", "2010-06-01"), ["Elixir"]);
    assert.deepEqual(descriptionsAt(graph, "decision/lang", "2015-01-01"), []);
    assert.deepEqual(descriptionsAt(graph, "decision/lang", "2022-01-01"), ["Elixir"]);
    assert.deepEqual(descriptionsAt(graph, "decision/lang"), []);
  } finally {
    closeGraph(graph);
  }
});

test("correct retract withdraws across valid time but not as_of", () => {
  const graph = fresh();
  try {
    const written = transact(graph, {
      reason: "typo",
      facts: [{ e: "decision/cache", a: "description", v: "Redsi" }],
    });
    const corrected = retract(graph, {
      reason: "recorded in error",
      mode: "correct",
      facts: [{ e: "decision/cache", a: "description", v: "Redsi" }],
    });
    assert.equal(corrected.mode, "correct");
    assert.equal(corrected.tx, (written.tx as number) + 1);
    assert.deepEqual(descriptionsAt(graph, "decision/cache", "any"), []);
    const earlier = query(graph, {
      as_of: written.tx as number,
      valid_at: "any",
      find: ["v"],
      where: [{ e: "decision/cache", a: "description", v: "?v" }],
    });
    assert.deepEqual(earlier.rows, [{ v: "Redsi" }]);
  } finally {
    closeGraph(graph);
  }
});

test("retract rejects bad modes and windows", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "seed",
      facts: [
        { e: "decision/db", a: "description", v: "PostgreSQL", valid_from: "2020-01-01" },
      ],
    });
    const fact = { e: "decision/db", a: "description", v: "PostgreSQL" };
    const before = graph.tx;
    assert.equal(
      message(() => retract(graph, { reason: "x", mode: "erase", facts: [fact] })),
      "mode must be close or correct",
    );
    assert.equal(
      message(() =>
        retract(graph, { reason: "x", mode: "correct", valid_at: "2021-01-01", facts: [fact] }),
      ),
      "mode correct takes no valid_at",
    );
    assert.equal(
      message(() => retract(graph, { reason: "x", valid_at: "2019-01-01", facts: [fact] })),
      "valid_at must be after the fact's valid_from",
    );
    assert.equal(
      message(() => retract(graph, { reason: "x", valid_at: "2999-01-01", facts: [fact] })),
      "valid_at must not be in the future",
    );
    assert.equal(
      message(() =>
        retract(graph, {
          reason: "x",
          facts: [fact, { e: "decision/db", a: "description", v: "missing" }],
        }),
      ),
      "fact is not current",
    );
    // Every check runs before any write.
    assert.equal(graph.tx, before);
    assert.deepEqual(descriptionsAt(graph, "decision/db"), ["PostgreSQL"]);
  } finally {
    closeGraph(graph);
  }
});

test("backdated entities appear in overview at their valid time and as_of", () => {
  const graph = fresh();
  try {
    const written = transact(graph, {
      reason: "history import",
      facts: [
        { e: "decision/old", a: "description", v: "old choice", valid_from: "2020-01-01" },
      ],
    });
    assert.deepEqual(overview(graph, { valid_at: "2021-01-01" }).entities, ["decision/old"]);
    assert.deepEqual(overview(graph, {}).entities, ["decision/old"]);
    assert.deepEqual(
      overview(graph, { as_of: written.tx as number, valid_at: "2021-01-01" }).entities,
      ["decision/old"],
    );
  } finally {
    closeGraph(graph);
  }
});

test("a fact with only valid_to has no start", () => {
  const graph = fresh();
  try {
    transact(graph, {
      reason: "history import",
      facts: [{ e: "decision/past", a: "description", v: "ended", valid_to: "2023-06-01" }],
    });
    assert.deepEqual(descriptionsAt(graph, "decision/past", "2021-01-01"), ["ended"]);
    assert.deepEqual(descriptionsAt(graph, "decision/past"), []);
    assert.deepEqual(overview(graph, { valid_at: "2021-01-01" }).entities, ["decision/past"]);
  } finally {
    closeGraph(graph);
  }
});

test("writes store no reason facts on entities", () => {
  const graph = fresh();
  try {
    const written = transact(graph, {
      reason: "why it matters",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    });
    assert.equal(written.reason, "why it matters");
    const attrs = query(graph, {
      datalog: "(query [:find ?a :valid-at :any-valid-time :where [:decision/db ?a ?v]])",
    });
    const names = (attrs.results as string[][]).map((row) => row[0]).sort();
    assert.deepEqual(names, ["alchemist/ident", "description"]);
  } finally {
    closeGraph(graph);
  }
});

test("tx counter skips failed writes and reconciles on open", () => {
  const file = graphFile();
  const first = openGraph(file);
  assert.equal(
    transact(first, {
      reason: "seed",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    }).tx,
    1,
  );
  assert.match(
    message(() => transact(first, { reason: "bad rule", rules: ["(rule [(bad ?x)])"] })),
    /at least one pattern/,
  );
  assert.equal(
    retract(first, {
      reason: "error",
      mode: "correct",
      facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
    }).tx,
    2,
  );
  closeGraph(first);

  // Last write was a retract, so no live fact carries tx 2.
  for (const stored of ["0", "9"]) {
    fs.writeFileSync(`${file}.tx`, stored);
    const reopened = openGraph(file);
    try {
      assert.equal(reopened.tx, 2, `stored ${stored}`);
    } finally {
      closeGraph(reopened);
    }
    assert.equal(fs.readFileSync(`${file}.tx`, "utf8"), "2");
  }

  const last = openGraph(file);
  try {
    const next = transact(last, {
      reason: "again",
      facts: [{ e: "decision/db", a: "description", v: "CockroachDB" }],
    });
    assert.equal(next.tx, 3);
    const atTx = query(last, {
      as_of: 3,
      find: ["v"],
      where: [{ e: "decision/db", a: "description", v: "?v" }],
    });
    assert.deepEqual(atTx.rows, [{ v: "CockroachDB" }]);
  } finally {
    closeGraph(last);
  }
});

test("a rejected rule stores nothing and writes no facts", () => {
  const file = graphFile();
  const graph = openGraph(file);
  assert.match(
    message(() =>
      transact(graph, {
        reason: "mixed",
        rules: ["(rule [(named ?e ?v) [?e :description ?v]])", "(rule [(bad ?x)])"],
        facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
      }),
    ),
    /at least one pattern/,
  );
  assert.equal(graph.tx, 0);
  assert.deepEqual(overview(graph, {}).entities, []);
  closeGraph(graph);
  const reopened = openGraph(file);
  try {
    assert.deepEqual(reopened.skippedRules, []);
  } finally {
    closeGraph(reopened);
  }
});

test("a bad stored rule is skipped on open instead of failing", () => {
  const file = graphFile();
  const graph = openGraph(file);
  transact(graph, {
    reason: "persist",
    rules: ["(rule [(named ?e ?v) [?e :description ?v]])"],
    facts: [{ e: "decision/db", a: "description", v: "PostgreSQL" }],
  });
  // A rule stored by an older build, before rules were checked first.
  graph.db.execute('(transact [[:alchemist/rule-99 :seq 99] [:alchemist/rule-99 :text "(rule [(bad ?x)])"]])');
  closeGraph(graph);
  const reopened = openGraph(file);
  try {
    assert.deepEqual(reopened.skippedRules, ["(rule [(bad ?x)])"]);
    const rows = query(reopened, {
      datalog: "(query [:find ?v :where (named :decision/db ?v)])",
    });
    assert.deepEqual(rows.results, [["PostgreSQL"]]);
  } finally {
    closeGraph(reopened);
  }
});
