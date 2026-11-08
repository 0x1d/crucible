// Memory section of the voice agent's system prompt (spec 10 §10.5): temporal-reasoning skill for a
// voice assistant (condensed from its SKILL.md), wiki rules, wiki page list.
import type { Memory } from "./memory.js";
import { MEMORY_SERVER, WIKI_SERVER } from "./tools.js";

const MAX_INDEX_LINES = 40;

export function memoryPrompt(mem: Memory, now: Date, timeZone?: string): string {
  const local = now.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", ...(timeZone ? { timeZone } : {}) });
  const index = mem.wiki.indexLines();
  const pages = index.length
    ? `${index.slice(0, MAX_INDEX_LINES).join("\n")}${index.length > MAX_INDEX_LINES ? `\n… (${index.length - MAX_INDEX_LINES} more; ${WIKI_SERVER} index)` : ""}`
    : "None yet.";
  const m = (t: string) => `mcp__${MEMORY_SERVER}__${t}`;
  return `## Memory

Now: ${local} (${now.toISOString()}).

You have a long-term memory of this user: a bi-temporal graph (the ${MEMORY_SERVER} tools). Every fact has
a valid time (when it was true) and a transaction time (when it was recorded); changing a fact keeps
its history. Never say you have no memory; say you don't know yet. Memory tools are local and fast:
do not announce them, just use them.

### Each turn
- A <memory-context> block before the user's words holds facts matching their message, found
  automatically. Use it; it may be incomplete.
- After each turn, durable facts the user stated are extracted and stored automatically, including
  what they ask you to remember: just acknowledge it briefly, do not write it yourself.
- Write yourself only when a fact changes or was wrong (retract the stored triple, then transact the new
  one) or when the user asks you to forget something.

### Facts
- Triples [entity attribute value]. Entity idents are namespaced, lowercase, hyphens:
  :preference/ (likes, dislikes, how the user wants things done), :decision/ (choices and plans),
  :constraint/ (other lasting personal facts: people, places, routines, appointments, restrictions),
  :dependency/ (devices and services the user relies on). No other namespaces are accepted.
- Attributes: :description (required, one sentence "The user …", people by name; dates and times as absolute
  dates in the text), :rationale, :alias (2-5 comma-separated other words for it: retrieval is lexical).
  No other attributes are accepted. Never infer gender or pronouns.
- Before minting an entity, look for an existing one and reuse its ident:
  [:find ?e ?d :where [?e :description ?d] [(contains? ?d "coffee")]]  (predicates need square brackets).

### Tools
- ${m("minigraf_query")}: Datalog. Current: [:find ?a ?v :where [:preference/coffee-milk ?a ?v]].
  At a time: [:find ?d :valid-at "2026-08-01" :where [?e :description ?d]]. All history with windows
  (ms since epoch; 9223372036854775807 = still true):
  [:find ?d ?vf ?vt :any-valid-time :where [:preference/coffee-milk :description ?d] [:preference/coffee-milk :db/valid-from ?vf] [:preference/coffee-milk :db/valid-to ?vt]]
- ${m("minigraf_transact")}: facts '[[:preference/coffee-milk :description "The user takes oat milk in coffee"]]',
  a reason, optional valid_at (YYYY-MM-DD or ISO) when it became true earlier.
- ${m("minigraf_retract")}: a fact stopped being true (changed preference, revised plan): retract the
  exact current triple (default mode, history kept), then transact the new one. The user says it was
  wrong or asks you to forget it: mode "correct".

### Wiki
A markdown wiki (the ${WIKI_SERVER} tools) for entities and concepts the user explicitly asks you to keep there
("put Anna in the wiki", "make a wiki page for my garden project"). Write it only on such a request;
facts still go to the graph. Read pages when a question is about a page listed below.

Wiki pages:
${pages}`;
}
