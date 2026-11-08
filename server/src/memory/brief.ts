// Session brief (spec 10 §10.5): written by the librarian run; event section regenerated at session open.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Memory } from "./memory.js";
import { occurrences } from "./rrule.js";
import type { Fact } from "./temporal.js";
import { links, sections } from "./wiki.js";

/** ≈ 1500 tokens. */
export const MAX_BRIEF_CHARS = 6000;
const EVENTS_HEADING = "### Upcoming events";
const DAY = 86_400_000;

export interface EventOccurrence {
  fact: Fact;
  start: Date;
  end: Date;
}

/** Event occurrences overlapping [from, to), recurring events expanded. */
export function eventsBetween(mem: Memory, from: Date, to: Date): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const f of mem.temporal.facts({ kind: "event", history: true })) {
    const start = new Date(f.valid_from);
    const end = new Date(f.valid_to ?? f.valid_from);
    const rule = typeof f.attrs.recurrence === "string" ? f.attrs.recurrence : undefined;
    for (const o of occurrences(start, Math.max(1000, end.getTime() - start.getTime()), rule, from, to)) {
      out.push({ fact: f, ...o });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function formatWhen(d: Date, timeZone?: string): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

function eventSection(mem: Memory, now: Date, timeZone?: string): string {
  const lines = eventsBetween(mem, now, new Date(now.getTime() + 7 * DAY))
    .slice(0, 15)
    .map((e) => `- ${formatWhen(e.start, timeZone)}: ${e.fact.text}`);
  return `${EVENTS_HEADING}\n\n${lines.length ? lines.join("\n") : "None known."}`;
}

/** Full brief from the current wiki and temporal store. */
export function buildBrief(mem: Memory, now = new Date(), timeZone?: string): string {
  const parts: string[] = ["# Brief"];
  const user = mem.wiki.get("user");
  if (user) {
    const details = sections(user.body)
      .filter((s) => s.heading !== "Related")
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ");
    parts.push(`### User\n\n${clip(`${user.title}: ${user.summary} ${details}`, 900)}`);
  }
  const prefs = mem.temporal
    .facts({ kind: "preference" })
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
    .slice(0, 20);
  if (prefs.length) parts.push(`### Preferences\n\n${prefs.map((f) => `- ${f.text}`).join("\n")}`);
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const decisions = mem.temporal
    .facts({ kind: "decision" })
    .filter((f) => f.valid_from >= since)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
    .slice(0, 15);
  if (decisions.length) {
    parts.push(`### Recent decisions\n\n${decisions.map((f) => `- ${f.valid_from.slice(0, 10)}: ${f.text}`).join("\n")}`);
  }
  parts.push(eventSection(mem, now, timeZone));
  const top = topEntities(mem, 10);
  if (top.length) parts.push(`### Key pages\n\n${top.map((p) => `- [[${p.slug}]] — ${p.summary}`).join("\n")}`);
  return clip(parts.join("\n\n"), MAX_BRIEF_CHARS);
}

/** Most-referenced pages: inbound links + facts about them (the user page is in the profile). */
function topEntities(mem: Memory, n: number) {
  const refs = new Map<string, number>();
  const bump = (s: string, k = 1) => refs.set(s, (refs.get(s) ?? 0) + k);
  for (const p of mem.wiki.list()) for (const l of links(p.body)) if (l !== p.slug) bump(l);
  for (const f of mem.temporal.facts()) bump(f.subject);
  return mem.wiki
    .list()
    .filter((p) => p.slug !== "user")
    .map((p) => ({ p, n: refs.get(p.slug) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.p.slug.localeCompare(b.p.slug))
    .slice(0, n)
    .map((x) => x.p);
}

export async function writeBrief(mem: Memory, now = new Date(), timeZone?: string): Promise<string> {
  const brief = buildBrief(mem, now, timeZone);
  await writeFile(mem.space.brief, `${brief}\n`);
  return brief;
}

/** brief.md with a fresh event section (time-dependent), without its title line. */
export async function sessionBrief(mem: Memory, now = new Date(), timeZone?: string): Promise<string> {
  let text = existsSync(mem.space.brief) ? await readFile(mem.space.brief, "utf8") : "";
  if (!text.trim()) text = buildBrief(mem, now, timeZone);
  const events = eventSection(mem, now, timeZone);
  const start = text.indexOf(EVENTS_HEADING);
  if (start >= 0) {
    const next = text.indexOf("\n### ", start + EVENTS_HEADING.length);
    text = `${text.slice(0, start)}${events}${next >= 0 ? `\n${text.slice(next)}` : "\n"}`;
  } else {
    text = `${text.trimEnd()}\n\n${events}\n`;
  }
  return clip(text.replace(/^# Brief\n+/, "").trim(), MAX_BRIEF_CHARS);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Memory section appended to the persona system prompt at session open (spec §10.5, §10.6). */
export function memoryPrompt(brief: string, now: Date, timeZone?: string): string {
  const local = now.toLocaleString("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  });
  return `## Memory

Now: ${local} (${now.toISOString()}).

You have a long-term memory of past conversations with this user. What you know is summarised below.
- Use the memory tools only when the answer depends on the user's personal history, people, plans or preferences and the summary below is not enough: search or facts first, then read a page section.
- Memory tools are local and fast: do not announce them, just use them.
- When the user asks you to remember something, or states a lasting preference, decision, plan or personal detail worth keeping, call remember with one clear sentence.
- When the user asks you to forget something, call forget.
- Never say you have no memory; say you don't know yet.

${brief}`;
}
