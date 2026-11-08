// MCP sampling for temporal-reasoning fact extraction (spec 10 §10.4.3): one-shot Claude query, no tools.
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Sampler } from "./temporal-reasoning.js";

/** Prepended to the server's extraction prompt: the store's types are coding-oriented. */
export const EXTRACTION_GUIDE = `You extract long-term memory for a personal voice assistant. You are not part of the
conversation you are shown and nobody reads your reply but a parser: output only the Datalog block (or []),
no prose, no questions. If a detail is ambiguous or may be misheard, store it as the user said it.
The conversation is between the assistant and its user, about the user's life. Map what the user states or
confirms onto the allowed types:
- :preference/ for likes, dislikes and how the user wants things done (e.g. their name and how to be addressed);
- :decision/ for choices and plans the user made;
- :constraint/ for other lasting personal facts: people and how they relate to the user, places,
  routines, appointments, health or dietary restrictions;
- :dependency/ only for devices, services or things the user relies on.
Store only what the user said or confirmed, never what the assistant suggested. Small talk, questions
about general knowledge and anything not about the user's life: return [].
Write descriptions as one plain sentence about the user ("The user ..."), naming people by name. Put dates and
times into the description as absolute dates ("on Tuesday 10 November 2026 at 10:00"), resolved against the
current date below; do not use :date.
Never infer anyone's gender or pronouns.
Every fact is exactly one triple [entity attribute value]; give each attribute its own triple.`;

type Form = string | Form[];

/** EDN-ish reader for a transact block: vectors, strings, atoms; undefined on malformed input. */
function read(text: string): Form[] | undefined {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[[\]]|[^\s[\],]+/g) ?? [];
  const stack: Form[][] = [[]];
  for (const t of tokens) {
    if (t === "[") stack.push([]);
    else if (t === "]") {
      const done = stack.pop();
      if (!done || !stack.length) return undefined;
      stack[stack.length - 1]!.push(done);
    } else stack[stack.length - 1]!.push(t);
  }
  return stack.length === 1 ? stack[0] : undefined;
}

const write = (f: Form): string => (Array.isArray(f) ? `[${f.map(write).join(" ")}]` : f);

/**
 * Normalises a sampled memory block for the server's parser: code fences dropped, and an entity
 * vector with several attribute/value pairs ([:e :a1 "v1" :a2 "v2"]) split into triples, which the
 * server otherwise drops without error. A trailing "; valid-at:" line is kept.
 */
export function normalizeBlock(text: string): string {
  // The block alone, also when the model wrapped it in a fence or prose.
  const raw = /```[a-z]*\s*\n([\s\S]*?)\n?```/i.exec(text)?.[1] ?? text;
  const start = raw.search(/\[\s*(\[|\])/);
  const end = raw.lastIndexOf("]");
  const body = (start >= 0 && end > start ? raw.slice(start, end + 1) : raw).trim();
  const hint = /^\s*;\s*valid-at:.*$/im.exec(raw)?.[0].trim();
  const withHint = (b: string) => (hint ? `${hint}\n${b}` : b);
  const forms = read(body.replace(/^\s*;.*$/gm, ""));
  const top = forms?.length === 1 && Array.isArray(forms[0]) ? forms[0] : undefined;
  if (!top) return withHint(body);
  const triples: Form[][] = [];
  for (const v of top) {
    if (!Array.isArray(v) || v.length < 3 || v.length % 2 === 0) return withHint(body);
    for (let i = 1; i < v.length; i += 2) triples.push([v[0]!, v[i]!, v[i + 1]!]);
  }
  return withHint(`[${triples.map(write).join("\n ")}]`);
}

export function claudeSampler(model: string, timeZone?: string): Sampler {
  return async (prompt) => {
    const now = new Date();
    const local = now.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", ...(timeZone ? { timeZone } : {}) });
    const abortController = new AbortController();
    const q = query({
      prompt,
      options: {
        model,
        systemPrompt: `${EXTRACTION_GUIDE}\n\nNow: ${local}${timeZone ? ` (${timeZone})` : ""}.`,
        tools: [],
        permissionMode: "dontAsk",
        settingSources: [],
        settings: { autoMemoryEnabled: false },
        env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
        // Extraction is a formatting task: thinking only adds latency (≈ 15-30 s on Haiku).
        thinking: { type: "disabled" },
        maxTurns: 1,
        abortController,
      },
    });
    try {
      for await (const msg of q) {
        // The reply is complete with the assistant message; the result follows seconds later
        // (post-turn bookkeeping), so the query is aborted instead of awaited.
        if (msg.type === "assistant") {
          const text = msg.message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
          if (text) return normalizeBlock(text);
        }
        if (msg.type === "result") {
          if (msg.subtype !== "success") throw new Error(`sampling failed: ${msg.subtype}`);
          return normalizeBlock(msg.result);
        }
      }
      throw new Error("sampling ended without result");
    } finally {
      abortController.abort();
    }
  };
}
