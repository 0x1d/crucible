// Memory tools (spec 10 §10.6): server `memory` proxies temporal-reasoning; server `wiki` holds
// the wiki tools, written only on the user's explicit request.
import { z } from "zod";
import type { HostTool, ToolOutcome } from "../inference/types.js";
import type { Memory } from "./memory.js";
import { pageMeta, PAGE_TYPES, sections, SLUG, type Page } from "./wiki.js";

export const MEMORY_SERVER = "memory";
export const WIKI_SERVER = "wiki";

const slug = z.string().regex(SLUG);

function hostTool<S extends z.ZodObject>(
  name: string,
  description: string,
  schema: S,
  fn: (args: z.output<S>) => Promise<string> | string,
  policy: HostTool["policy"] = "allow",
): HostTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>,
    policy,
    async call(args): Promise<ToolOutcome> {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return { ok: false, text: `invalid arguments: ${z.prettifyError(parsed.error)}` };
      try {
        return { ok: true, text: await fn(parsed.data) };
      } catch (e) {
        return { ok: false, text: (e as Error).message };
      }
    },
  };
}

function renderPage(p: Page, section?: string): string {
  const head = [
    `slug: ${p.slug}`,
    `type: ${p.type}, kind: ${p.kind}`,
    `title: ${p.title}${p.aliases.length ? ` (aliases: ${p.aliases.join(", ")})` : ""}`,
    `summary: ${p.summary}`,
    `updated: ${p.updated ?? "?"}`,
    ...(p.facts.length ? [`facts: ${p.facts.join(", ")}`] : []),
  ];
  let body = p.body;
  if (section) {
    const s = sections(p.body).find((x) => x.heading.toLowerCase() === section.toLowerCase());
    if (!s) {
      const names = sections(p.body).map((x) => x.heading);
      return `${head.join("\n")}\n\nNo section "${section}". Sections: ${names.join(", ") || "none"}`;
    }
    body = `## ${s.heading}\n\n${s.text}`;
  }
  return `${head.join("\n")}\n\n${body.trim()}`;
}

const metaInput = pageMeta.omit({ created: true, updated: true, sources: true }).extend({
  facts: z.array(z.string().max(60)).max(200).default([]).describe("Related temporal memory entity idents, e.g. :preference/coffee-milk"),
});

/** Wiki tools (server `wiki`). Writes are committed to the space's git repository. */
export function wikiTools(mem: Memory): HostTool[] {
  const committed = async (msg: string) => {
    await mem.commitWiki(msg);
    return msg;
  };
  return [
    hostTool(
      "index",
      "List the wiki pages (one line per page: slug, kind, summary).",
      z.object({ type: z.enum(PAGE_TYPES).optional(), kind: z.string().optional() }),
      ({ type, kind }) => {
        const lines = mem.wiki.indexLines({ ...(type ? { type } : {}), ...(kind ? { kind } : {}) });
        if (!lines.length) return "The wiki has no pages yet.";
        return lines.length > 200 ? `${lines.slice(0, 200).join("\n")}\n… (${lines.length - 200} more)` : lines.join("\n");
      },
    ),
    hostTool(
      "search",
      "Search the wiki pages (titles, aliases, summaries, sections).",
      z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).optional() }),
      ({ query, limit }) => {
        const pages = mem.search.search(query, limit ?? 8);
        if (!pages.length) return "No wiki page matches.";
        return pages
          .map((p) => `- ${p.slug} (${p.kind}) ${p.title} — ${p.summary}${p.sections.length ? ` [sections: ${p.sections.join(", ")}]` : ""}`)
          .join("\n");
      },
    ),
    hostTool(
      "read",
      "Read one wiki page, or one of its sections (H2 heading).",
      z.object({ slug, section: z.string().max(120).optional() }),
      ({ slug: s, section }) => {
        const p = mem.wiki.get(s);
        return p ? renderPage(p, section) : `No page "${s}".`;
      },
    ),
    hostTool(
      "write_page",
      "Create or replace a wiki page: entity (person, place, pet, organisation, project, device) or concept " +
        "(topic, interest, routine). Body: markdown, `## Summary` first, `## Related` with [[slug]] links last. " +
        "Only when the user asks for something to be kept in the wiki.",
      z.object({ slug, meta: metaInput, body: z.string().max(8000) }),
      async ({ slug: s, meta, body }) => {
        const prev = mem.wiki.get(s);
        const p = await mem.wiki.write(s, { ...meta, sources: prev?.sources ?? [] }, body);
        return committed(`wrote ${p.type} ${p.slug}`);
      },
    ),
    hostTool(
      "patch_section",
      "Replace or append to one H2 section of a wiki page (created if missing).",
      z.object({ slug, heading: z.string().min(1).max(120), content: z.string().max(8000), mode: z.enum(["replace", "append"]).optional() }),
      async ({ slug: s, heading, content, mode }) => {
        await mem.wiki.patchSection(s, heading, content, mode ?? "replace");
        return committed(`patched ${s}#${heading}`);
      },
    ),
    hostTool("rename", "Rename a wiki page slug; rewrites [[links]].", z.object({ from: slug, to: slug }), async ({ from, to }) => {
      await mem.wiki.rename(from, to);
      return committed(`renamed ${from} → ${to}`);
    }),
    hostTool(
      "merge",
      "Merge wiki page `from` into page `into` (aliases, facts, sections); rewrites [[links]]; deletes `from`.",
      z.object({ from: slug, into: slug }),
      async ({ from, into }) => {
        await mem.wiki.merge(from, into);
        return committed(`merged ${from} → ${into}`);
      },
    ),
    hostTool(
      "delete",
      "Delete a wiki page (asks the user on the device first).",
      z.object({ slug }),
      async ({ slug: s }) => {
        if (!mem.wiki.get(s)) return `No page "${s}".`;
        await mem.wiki.delete(s);
        return committed(`deleted ${s}`);
      },
      "ask",
    ),
  ];
}
