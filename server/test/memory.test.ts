// Long-term memory (spec 10): wiki, search, temporal-reasoning client, wiki tools, prompt.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { hostToolServer } from "../src/inference/claude/backend.js";
import type { HostTool } from "../src/inference/types.js";
import { Memory } from "../src/memory/memory.js";
import { memoryPrompt } from "../src/memory/prompt.js";
import { normalizeBlock } from "../src/memory/sampler.js";
import { AGENT_TOOLS } from "../src/memory/temporal-reasoning.js";
import { wikiTools } from "../src/memory/tools.js";
import { parsePage, serializePage } from "../src/memory/wiki.js";
import { captureLog } from "./fakes.js";

const FAKE_SERVER = fileURLToPath(new URL("./fixtures/fake-temporal-mcp.mjs", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "hom-mem-"));
const open = async (sampled: string[] = [], reply = "[]") =>
  Memory.open(tmp(), "test", captureLog(), {
    temporal: {
      command: process.execPath,
      args: [FAKE_SERVER],
      sample: async (prompt) => {
        sampled.push(prompt);
        return reply;
      },
    },
  });

const alice = {
  type: "entity" as const,
  kind: "person",
  title: "Alice",
  aliases: ["Ali", "my sister"],
  summary: "User's younger sister; lives in Graz.",
};

async function call(tools: HostTool[], name: string, args: unknown = {}) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name}`);
  return t.call(args);
}

test("page round trip, patch, rename, merge, index", async () => {
  const mem = await open();
  const w = mem.wiki;
  await w.write("alice", alice, "## Summary\n\nSister.\n\n## Details\n\nWorks as a nurse.\n\n## Related\n\n[[graz]]");
  await w.write("graz", { type: "entity", kind: "place", title: "Graz", summary: "City in Austria." }, "## Summary\n\nCity.");
  await w.write("ali", { ...alice, title: "Ali", aliases: [] }, "## Summary\n\nDuplicate.\n\n## Hobbies\n\nClimbing.");
  const p = parsePage("alice", serializePage(w.get("alice")!));
  assert.deepEqual(p.aliases, ["Ali", "my sister"]);
  assert.match(serializePage(p), /aliases: \[Ali, my sister\]/);

  await w.patchSection("alice", "Details", "Works as a nurse in Graz.");
  await w.patchSection("alice", "Pets", "A cat called Mo.");
  assert.match(w.get("alice")!.body, /## Details\n\nWorks as a nurse in Graz\.\n\n## Related/);
  assert.match(w.get("alice")!.body, /## Pets\n\nA cat called Mo\./);

  await w.write("user", { type: "entity", kind: "person", title: "Sam", summary: "The user." }, "## Related\n\n[[alice]] [[ali]]");
  await w.merge("ali", "alice");
  assert.equal(w.get("ali"), undefined);
  assert.match(w.get("alice")!.body, /## Hobbies \(from Ali\)\n\nClimbing\./);
  assert.match(w.get("user")!.body, /\[\[alice\]\] \[\[alice\]\]/);

  await w.rename("graz", "graz-austria");
  assert.match(w.get("alice")!.body, /\[\[graz-austria\]\]/);
  assert.deepEqual(w.indexLines(), [
    "## Entities",
    "- [[alice]] (person) — User's younger sister; lives in Graz.",
    "- [[graz-austria]] (place) — City in Austria.",
    "- [[user]] (person) — The user.",
  ]);
  await assert.rejects(w.write("Bad Slug", alice, ""));
  await assert.rejects(w.write("big", alice, "x".repeat(9000)));
  await mem.close();
});

test("search ranks title and alias matches, reports sections", async () => {
  const mem = await open();
  await mem.wiki.write("alice", alice, "## Summary\n\nSister.\n\n## Work\n\nNurse at the hospital.");
  await mem.wiki.write("bob", { ...alice, title: "Bob", aliases: [], summary: "Neighbour." }, "## Summary\n\nMentions Alice once.");
  const r = mem.search.search("alice nurse");
  assert.equal(r[0]!.slug, "alice");
  assert.deepEqual(r[0]!.sections, ["Work"]);
  assert.equal(r[1]!.slug, "bob");
  assert.equal(mem.search.search("sister")[0]!.slug, "alice");
  await mem.wiki.delete("alice");
  assert.deepEqual(mem.search.search("nurse"), []);
  await mem.close();
});

test("temporal-reasoning: agent tools proxied, prepare, finalize via sampling", async () => {
  const sampled: string[] = [];
  const mem = await open(sampled, '[[:preference/address-as :description "The user wants to be called Operator"]]');
  const tools = mem.temporal.tools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...AGENT_TOOLS].sort());
  assert.ok(tools.every((t) => t.policy === "allow"));
  assert.doesNotThrow(() => hostToolServer("memory", tools));

  const ok = await call(tools, "minigraf_transact", { facts: '[[:preference/coffee-milk :description "The user takes oat milk"]]', reason: "stated" });
  assert.equal(ok.ok, true);
  const bad = await call(tools, "minigraf_transact", { facts: '[[:person/alice :description "Sister"]]', reason: "x" });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /unknown type/);
  assert.match((await call(tools, "minigraf_query", { datalog: "[:find ?d :where [?e :description ?d]]" })).text, /oat milk/);

  assert.match(await mem.temporal.prepare("what milk do I take?"), /oat milk/);
  assert.equal(await mem.temporal.prepare("weather tomorrow"), "");

  await mem.temporal.finalize("User: Call me Operator.\nAssistant: Sure, Operator.");
  assert.equal(sampled.length, 1);
  assert.match(sampled[0]!, /User: Call me Operator\./);
  assert.match(await mem.temporal.prepare("what do you call the operator"), /Operator/);
  await mem.close();
});

test("wiki tools write, read, search, delete (ask); writes are committed", async () => {
  const mem = await open();
  const tools = wikiTools(mem);
  assert.doesNotThrow(() => hostToolServer("wiki", tools));
  assert.equal(tools.find((t) => t.name === "delete")!.policy, "ask");
  const w = await call(tools, "write_page", { slug: "alice", meta: alice, body: "## Summary\n\nSister.\n\n## Work\n\nNurse." });
  assert.equal(w.ok, true, w.text);
  assert.match((await call(tools, "read", { slug: "alice", section: "work" })).text, /## Work\n\nNurse\./);
  assert.match((await call(tools, "search", { query: "nurse" })).text, /alice \(person\) Alice/);
  assert.match((await call(tools, "index")).text, /\[\[alice\]\]/);
  assert.equal((await call(tools, "write_page", { slug: "Bad", meta: alice, body: "" })).ok, false);
  await call(tools, "patch_section", { slug: "alice", heading: "Pets", content: "A cat." });
  await call(tools, "delete", { slug: "alice" });
  assert.equal(mem.wiki.get("alice"), undefined);
  const log = execFileSync("git", ["-C", mem.space.root, "log", "--format=%s"], { encoding: "utf8" });
  assert.deepEqual(log.trim().split("\n"), ["deleted alice", "patched alice#Pets", "wrote entity alice", "init"]);
  await mem.close();
});

test("memory prompt: time, tools, wiki pages", async () => {
  const mem = await open();
  await mem.wiki.write("alice", alice, "## Summary\n\nSister.");
  const p = memoryPrompt(mem, new Date("2026-11-08T10:00:00Z"), "Europe/Vienna");
  assert.match(p, /Sunday, 8 November 2026 at 11:00 \(2026-11-08T10:00:00.000Z\)/);
  assert.match(p, /mcp__memory__minigraf_query/);
  assert.match(p, /<memory-context>/);
  assert.match(p, /- \[\[alice\]\] \(person\) — User's younger sister/);
  await mem.close();
});

test("sampled memory blocks are normalised to triples", () => {
  assert.equal(
    normalizeBlock('```datalog\n[[:preference/tea :description "Tea with honey." :alias "tea, honey"]]\n```'),
    '[[:preference/tea :description "Tea with honey."]\n [:preference/tea :alias "tea, honey"]]',
  );
  assert.equal(normalizeBlock('[\n  [:a/b :description "x [y] \\"q\\""],\n  [:a/c :description "z"]\n]'), '[[:a/b :description "x [y] \\"q\\""]\n [:a/c :description "z"]]');
  assert.equal(normalizeBlock('; valid-at: 2026-01-01\n[[:a/b :description "x"]]'), '; valid-at: 2026-01-01\n[[:a/b :description "x"]]');
  assert.equal(normalizeBlock("[]"), "[]");
  assert.equal(
    normalizeBlock('I extracted:\n\n```\n[[:constraint/home :description "Lives in Linz"]]\n```\n\n(Check the spelling.)'),
    '[[:constraint/home :description "Lives in Linz"]]',
  );
  assert.equal(normalizeBlock('Here: [[:a/b :description "x"]] done.'), '[[:a/b :description "x"]]');
  assert.equal(normalizeBlock("Nothing to store."), "Nothing to store.");
});
