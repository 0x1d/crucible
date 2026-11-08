// Temporal store (spec 10 §10.4) on minigraf.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { TemporalStore, type FactInput } from "../src/memory/temporal.js";

const T0 = "2026-01-01T09:00:00.000Z";
const T1 = "2026-06-01T09:00:00.000Z";

const milk = (value: string, stated_at = T0): FactInput => ({
  kind: "preference",
  subject: "user",
  text: `The user takes ${value} in coffee.`,
  source: "2026-01-01/s1#t1",
  stated_at,
  topic: "coffee.milk",
  value,
  polarity: "likes",
});

test("assert and query current preference", () => {
  const s = TemporalStore.inMemory();
  const f = s.assert(milk("cow milk"));
  assert.match(f.id, /^pref:[0-9a-f-]{36}$/);
  const got = s.facts({ kind: "preference", topic: "coffee" });
  assert.equal(got.length, 1);
  assert.equal(got[0]!.attrs.value, "cow milk");
  assert.equal(got[0]!.attrs.polarity, "likes");
  assert.equal(got[0]!.valid_from, T0);
  assert.equal(got[0]!.valid_to, undefined);
  assert.equal(s.facts({ topic: "tea" }).length, 0);
});

test("supersede closes the old fact and keeps history", () => {
  const s = TemporalStore.inMemory();
  const a = s.assert(milk("cow milk"));
  const { closed, next } = s.supersede(a.id, milk("oat milk", T1), T1);
  assert.equal(closed.valid_to, T1);
  const now = s.facts({ topic: "coffee.milk" });
  assert.deepEqual(now.map((f) => f.attrs.value), ["oat milk"]);
  assert.equal(now[0]!.id, next.id);
  const before = s.facts({ topic: "coffee.milk", at: "2026-03-01T00:00:00.000Z" });
  assert.deepEqual(before.map((f) => f.attrs.value), ["cow milk"]);
  const history = s.facts({ topic: "coffee.milk", history: true });
  assert.deepEqual(history.map((f) => [f.attrs.value, f.valid_to]), [["cow milk", T1], ["oat milk", undefined]]);
});

test("retract hides the fact; as-of still shows it", async () => {
  const s = TemporalStore.inMemory();
  const f = s.assert(milk("cow milk"));
  // Transaction time has millisecond resolution.
  await sleep(3);
  const before = new Date().toISOString();
  await sleep(3);
  assert.equal(s.retract(f.id), true);
  assert.equal(s.facts().length, 0);
  assert.equal(s.facts({ history: true }).length, 0);
  assert.equal(s.facts({ asOf: before }).length, 1);
  assert.equal(s.retract(f.id), false);
});

test("event with participants, point window and escaping", () => {
  const s = TemporalStore.inMemory();
  const e = s.assert({
    kind: "event",
    subject: "alice",
    text: 'Dinner at "Luigi\'s" \\ with Alice and Bob.',
    source: "2026-01-01/s1#t2",
    stated_at: T0,
    valid_from: "2026-01-10T18:00:00.000Z",
    title: "Dinner",
    with: ["alice", "bob"],
    remind: true,
  });
  const [got] = s.facts({ kind: "event", history: true });
  assert.equal(got!.id, e.id);
  assert.deepEqual(got!.attrs.with, ["alice", "bob"]);
  assert.equal(got!.attrs.remind, true);
  assert.equal(got!.text, 'Dinner at "Luigi\'s" \\ with Alice and Bob.');
  assert.equal(got!.valid_to, "2026-01-10T18:00:01.000Z");
  assert.equal(s.facts({ kind: "event", at: "2026-01-10T18:00:00.500Z" }).length, 1);
  assert.equal(s.retract(e.id), true);
  assert.equal(s.facts({ kind: "event", history: true }).length, 0);
});

test("validation and raw query", () => {
  const s = TemporalStore.inMemory();
  assert.throws(() => s.assert({ ...milk("x"), topic: "Coffee Milk" } as FactInput));
  assert.throws(() => s.assert({ ...milk("x"), subject: "Not A Slug" } as FactInput));
  assert.throws(() => s.query("(transact [[:a :b 1]])"));
  s.assert(milk("cow milk"));
  const r = s.query("(query [:find ?v :where [?e :pref/value ?v]])");
  assert.deepEqual(r.results, [["cow milk"]]);
});

test("file-backed store survives reopen", () => {
  const path = join(mkdtempSync(join(tmpdir(), "hom-tg-")), "memory.graph");
  const s = TemporalStore.open(path);
  const f = s.assert(milk("cow milk"));
  s.checkpoint();
  s.close();
  const again = TemporalStore.open(path);
  assert.equal(again.get(f.id)?.attrs.value, "cow milk");
  again.close();
});
