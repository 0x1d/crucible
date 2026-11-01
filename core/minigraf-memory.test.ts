import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeGraph,
  MemoryError,
  openGraph,
  query,
  recall,
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
    assert.equal(retracted.tx, 2);

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

    const hits = recall(graph, { question: "CockroachDB choice" });
    assert.equal(hits.count, 1);
    assert.equal((hits.hits as Array<{ description: string }>)[0].description, "CockroachDB");
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
