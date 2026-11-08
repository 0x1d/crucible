// Long-term memory (spec 10): wiki, search, source log, tools, librarian runs, brief.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hostToolServer } from "../src/inference/claude/backend.js";
import type { HostTool } from "../src/inference/types.js";
import { memoryPrompt, sessionBrief } from "../src/memory/brief.js";
import { Librarian, lintReport, type AgentRunner } from "../src/memory/librarian.js";
import { Memory } from "../src/memory/memory.js";
import { occurrences } from "../src/memory/rrule.js";
import { advanceCursor } from "../src/memory/source-log.js";
import { MEMORY_ADMIN_SERVER, memoryAdminTools, memoryTools } from "../src/memory/tools.js";
import { parsePage, serializePage } from "../src/memory/wiki.js";
import { captureLog } from "./fakes.js";

const tmp = () => mkdtempSync(join(tmpdir(), "hom-mem-"));
const open = async () => Memory.open(tmp(), "test", captureLog());

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
  assert.match(serializePage(p), /aliases: \[ Ali, my sister \]|aliases: \[Ali, my sister\]/);

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
  mem.close();
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
  mem.close();
});

test("source log append, pending, redact, cursor", async () => {
  const mem = await open();
  const s = mem.sources.newSession("dev-1", new Date("2026-11-08T10:00:00Z"));
  assert.match(s.ref, /^2026-11-08\/100000-[0-9a-f]{6}$/);
  assert.equal(s.nextRef(), `${s.ref}#t1`);
  await s.append({ at: "2026-11-08T10:00:01Z", user: "I take oat milk now.", assistant: "Got it,\noat milk.", tools: [] });
  await s.append({ at: "2026-11-08T10:01:00Z", user: "Weather?", assistant: "Sunny", tools: ["WebSearch"], heard: "Sun" });
  const turns = await mem.sources.read(s.ref);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]!.assistant, "Got it, oat milk.");
  assert.deepEqual(turns[1]!.tools, ["WebSearch"]);
  assert.equal(turns[1]!.heard, "Sun");

  assert.equal((await mem.sources.pending({ sessions: {} })).length, 2);
  assert.equal((await mem.sources.pending({ sessions: { [s.ref]: 1 } })).length, 1);
  assert.equal(await mem.sources.redact(`${s.ref}#t1`), true);
  const after = await mem.sources.read(s.ref);
  assert.equal(after[0]!.redacted, true);
  assert.equal(after[0]!.user, "");
  assert.equal(after[1]!.user, "Weather?");

  const c = advanceCursor({ sessions: {} }, turns, [], new Date("2026-11-20T00:00:00Z"));
  assert.equal(c.before, "2026-11-13");
  assert.deepEqual(c.sessions, {});
  const c2 = advanceCursor({ sessions: {} }, turns.slice(0, 1), turns.slice(1), new Date("2026-11-20T00:00:00Z"));
  assert.equal(c2.before, "2026-11-08");
  assert.deepEqual(c2.sessions, { [s.ref]: 1 });
  mem.close();
});

test("voice-agent tools: search, read, facts, remember, forget policy", async () => {
  const mem = await open();
  await mem.wiki.write("alice", { ...alice, facts: [] }, "## Summary\n\nSister.\n\n## Work\n\nNurse.");
  const f = mem.temporal.assert({
    kind: "preference",
    subject: "user",
    text: "The user takes oat milk in coffee.",
    source: "2026-11-08/x#t1",
    stated_at: "2026-11-08T10:00:00.000Z",
    topic: "coffee.milk",
    value: "oat milk",
    polarity: "likes",
  });
  let inbox = 0;
  const tools = memoryTools(mem, { sourceRef: () => "2026-11-08/y#t3", onInbox: () => inbox++ });
  assert.equal(tools.find((t) => t.name === "forget")!.policy, "ask");
  assert.ok(tools.filter((t) => t.name !== "forget").every((t) => t.policy === "allow"));

  const s = await call(tools, "search", { query: "Alice coffee milk" });
  assert.match(s.text, /- alice \(person\) Alice/);
  assert.match(s.text, new RegExp(f.id));
  assert.match((await call(tools, "read", { slug: "alice", section: "work" })).text, /## Work\n\nNurse\./);
  assert.match((await call(tools, "read", { slug: "nobody" })).text, /No page/);
  assert.match((await call(tools, "facts", { topic: "coffee" })).text, /oat milk/);
  assert.match((await call(tools, "index")).text, /\[\[alice\]\]/);
  assert.equal((await call(tools, "search", { query: "" })).ok, false);

  await call(tools, "remember", { text: "Alice's birthday is 3 May.", kind_hint: "event" });
  await call(tools, "forget", { text: "the cat" });
  assert.equal(inbox, 2);
  const entries = await mem.inbox();
  assert.deepEqual(
    entries.map((e) => [e.op, e.kindHint, e.source, e.text]),
    [
      ["remember", "event", "2026-11-08/y#t3", "Alice's birthday is 3 May."],
      ["forget", undefined, "2026-11-08/y#t3", "the cat"],
    ],
  );
  await mem.ackInbox(entries.slice(0, 1));
  assert.equal((await mem.inbox()).length, 1);
  mem.close();
});

test("tool schemas convert for the SDK MCP server", async () => {
  const mem = await open();
  const run = { delivered: [], taken: [], changes: [] };
  const all = [...memoryTools(mem, { sourceRef: () => undefined, onInbox: () => {} }), ...memoryAdminTools(mem, run, async () => [])];
  assert.doesNotThrow(() => hostToolServer("memory", all));
  mem.close();
});

test("rrule expansion", () => {
  const start = new Date("2026-11-02T08:00:00Z"); // Monday
  const from = new Date("2026-11-08T00:00:00Z");
  const to = new Date("2026-11-22T00:00:00Z");
  const weekly = occurrences(start, 3600_000, "FREQ=WEEKLY;BYDAY=MO,TH", from, to).map((o) => o.start.toISOString());
  assert.deepEqual(weekly, [
    "2026-11-09T08:00:00.000Z",
    "2026-11-12T08:00:00.000Z",
    "2026-11-16T08:00:00.000Z",
    "2026-11-19T08:00:00.000Z",
  ]);
  assert.equal(occurrences(start, 1000, "FREQ=DAILY;COUNT=3", from, to).length, 0);
  assert.equal(occurrences(start, 1000, "FREQ=DAILY;UNTIL=20261110", from, to).length, 3);
  assert.equal(occurrences(new Date("2026-11-10T08:00:00Z"), 1000, undefined, from, to).length, 1);
});

/** Fake librarian agent: files the oat-milk turn and the inbox note through the admin tools. */
const scriptedRunner = (calls: string[]): AgentRunner => async ({ servers, prompt }) => {
  const admin = servers[MEMORY_ADMIN_SERVER]!;
  calls.push(prompt.split("\n")[0]!);
  const notes = await call(admin, "inbox_take");
  const src = await call(admin, "sources_read");
  if (/oat milk/.test(src.text)) {
    const ref = /\[(\S+#t\d+) /.exec(src.text)![1]!;
    await call(admin, "wiki_write_page", {
      slug: "user",
      meta: { type: "entity", kind: "person", title: "Sam", summary: "The user; lives in Vienna." },
      body: "## Summary\n\nSam lives in Vienna.\n\n## Related\n\n[[alice]]",
    });
    const r = await call(admin, "facts_assert", {
      fact: {
        kind: "preference",
        subject: "user",
        text: "Sam takes oat milk in coffee.",
        source: ref,
        stated_at: "2026-11-08T10:00:01.000Z",
        topic: "coffee.milk",
        value: "oat milk",
        polarity: "likes",
      },
    });
    assert.ok(r.ok, r.text);
  }
  if (/birthday/.test(notes.text)) {
    await call(admin, "wiki_write_page", { slug: "alice", meta: alice, body: "## Summary\n\nSister." });
    const ev = await call(admin, "facts_assert", {
      fact: {
        kind: "event",
        subject: "alice",
        text: "Alice's birthday.",
        source: "2026-11-08/y#t3",
        stated_at: "2026-11-08T10:00:00.000Z",
        valid_from: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        title: "Alice's birthday",
        recurrence: "FREQ=YEARLY",
      },
    });
    assert.ok(ev.ok, ev.text);
  }
  return { ok: true, summary: "filed", costUsd: 0.01 };
};

test("librarian ingest: cursor, inbox, index, brief, git commit; idle run skipped", async () => {
  const mem = await open();
  const s = mem.sources.newSession("dev-1");
  await s.append({ at: "2026-11-08T10:00:01Z", user: "I take oat milk in my coffee.", assistant: "Noted.", tools: [] });
  await mem.addInbox({ at: "2026-11-08T10:00:02Z", op: "remember", text: "Alice's birthday is in two days." });
  const calls: string[] = [];
  const lib = new Librarian(mem, scriptedRunner(calls), { lintHour: undefined }, captureLog());
  await lib.request("ingest");
  assert.deepEqual(calls, ["Ingest run."]);
  assert.equal((await mem.inbox()).length, 0);
  const st = await mem.librarianState();
  assert.equal(st.cursor.sessions[s.ref], 1);
  assert.equal(st.ingestsSinceLint, 1);
  assert.match(readFileSync(mem.space.index, "utf8"), /- \[\[user\]\] \(person\) — The user; lives in Vienna\./);
  const brief = readFileSync(mem.space.brief, "utf8");
  assert.match(brief, /### User\n\nSam: The user; lives in Vienna\./);
  assert.match(brief, /### Preferences\n\n- Sam takes oat milk in coffee\./);
  assert.match(brief, /### Upcoming events\n\n- .*: Alice's birthday\./);
  assert.match(readFileSync(mem.space.log, "utf8"), /ingest\n\n.*1 turns · 1 notes\n\n- wrote entity user/);
  const gitLog = execFileSync("git", ["-C", mem.space.root, "log", "--format=%s"], { encoding: "utf8" });
  assert.match(gitLog, /^\S+ ingest\ninit\n$/);
  assert.match(execFileSync("git", ["-C", mem.space.root, "ls-files"], { encoding: "utf8" }), /wiki\/entities\/user\.md/);
  assert.doesNotMatch(execFileSync("git", ["-C", mem.space.root, "ls-files"], { encoding: "utf8" }), /memory\.graph/);

  await lib.request("ingest"); // nothing pending: no agent run
  assert.equal(calls.length, 1);
  await s.append({ at: "2026-11-08T10:05:00Z", user: "Thanks.", assistant: "Sure.", tools: [] });
  await lib.request("ingest");
  assert.equal(calls.length, 2);
  assert.equal((await mem.librarianState()).cursor.sessions[s.ref], 2);

  const sb = await sessionBrief(mem);
  assert.doesNotMatch(sb, /^# Brief/);
  assert.match(memoryPrompt(sb, new Date()), /^## Memory\n\nNow: /);
  await lib.close();
  mem.close();
});

test("librarian failure keeps cursor and inbox", async () => {
  const mem = await open();
  const s = mem.sources.newSession("dev-1");
  await s.append({ at: "2026-11-08T10:00:01Z", user: "Hi", assistant: "Hello", tools: [] });
  await mem.addInbox({ at: "2026-11-08T10:00:02Z", op: "remember", text: "x" });
  const lib = new Librarian(
    mem,
    async ({ servers }) => {
      await call(servers[MEMORY_ADMIN_SERVER]!, "inbox_take");
      await call(servers[MEMORY_ADMIN_SERVER]!, "sources_read");
      return { ok: false, summary: "error_max_turns" };
    },
    { lintHour: undefined },
    captureLog(),
  );
  await lib.request("ingest");
  assert.equal((await mem.inbox()).length, 1);
  assert.deepEqual((await mem.librarianState()).cursor.sessions, {});
  assert.match(readFileSync(mem.space.log, "utf8"), /ingest \(failed\)/);
  await lib.close();
  mem.close();
});

test("admin supersede, merge resubjects facts; lint findings", async () => {
  const mem = await open();
  const run = { delivered: [], taken: [], changes: [] };
  const admin = memoryAdminTools(mem, run, async () => []);
  const pref = (value: string) => ({
    kind: "preference",
    subject: "ali",
    text: `Ali likes ${value}.`,
    source: "2026-11-08/x#t1",
    stated_at: "2026-01-01T00:00:00.000Z",
    topic: "drink",
    value,
    polarity: "likes",
    holder: "ali",
  });
  const a = await call(admin, "facts_assert", { fact: pref("tea") });
  const id = /pref:[0-9a-f-]{36}/.exec(a.text)![0];
  const sup = await call(admin, "facts_supersede", { id, at: "2026-06-01T00:00:00.000Z", fact: pref("coffee") });
  assert.ok(sup.ok, sup.text);
  await mem.wiki.write("alice", alice, "## Summary\n\nSister.");
  await mem.wiki.write("ali", { ...alice, title: "Ali", aliases: [], facts: [] }, "## Summary\n\nDup.");
  assert.match((await lintReport(mem)).join("\n"), /Possible duplicates \(name "ali"\): ali, alice/);
  await call(admin, "wiki_merge", { from: "ali", into: "alice" });
  const hist = mem.temporal.facts({ history: true, subject: "alice" });
  assert.deepEqual(hist.map((f) => [f.attrs.value, f.attrs.holder, f.valid_to]), [
    ["tea", "alice", "2026-06-01T00:00:00.000Z"],
    ["coffee", "alice", undefined],
  ]);
  assert.equal(mem.temporal.facts({ history: true, subject: "ali" }).length, 0);
  assert.deepEqual(run.changes.slice(-1), ["merged ali → alice"]);
  assert.equal((await call(admin, "facts_query", { datalog: "(retract [[:a :b 1]])" })).ok, false);
  mem.close();
});
