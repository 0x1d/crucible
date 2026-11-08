// Wiki (spec 10 §10.3): markdown pages with frontmatter, index generation, link rewrite.
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";

export const SLUG = /^[a-z0-9-]{1,64}$/;
export const MAX_PAGE_BYTES = 8192;
export const PAGE_TYPES = ["entity", "concept"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
const DIR: Record<PageType, string> = { entity: "entities", concept: "concepts" };

export const pageMeta = z.object({
  type: z.enum(PAGE_TYPES),
  kind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  title: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(30).default([]),
  summary: z.string().min(1).max(120),
  created: z.string().optional(),
  updated: z.string().optional(),
  sources: z.array(z.string().max(200)).max(200).default([]),
  facts: z.array(z.string().max(60)).max(200).default([]),
});
export type PageMeta = z.output<typeof pageMeta>;

export interface Page extends PageMeta {
  slug: string;
  body: string;
}

export interface Section {
  heading: string;
  text: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const LINK_RE = /\[\[([a-z0-9-]{1,64})\]\]/g;

export function parsePage(slug: string, text: string): Page {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${slug}: missing frontmatter`);
  const raw = YAML.parse(m[1]!) as Record<string, unknown>;
  // YAML may parse dates; keep them as strings.
  for (const k of ["created", "updated"]) if (raw[k] instanceof Date) raw[k] = (raw[k] as Date).toISOString().slice(0, 10);
  const meta = pageMeta.parse(raw);
  return { ...meta, slug, body: m[2]!.replace(/^\n+/, "") };
}

export function serializePage(p: Page): string {
  const doc = new YAML.Document({
    type: p.type,
    kind: p.kind,
    title: p.title,
    aliases: p.aliases,
    summary: p.summary,
    created: p.created,
    updated: p.updated,
    sources: p.sources,
    facts: p.facts,
  });
  YAML.visit(doc, {
    Seq(_, node) {
      node.flow = true;
    },
  });
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()}\n---\n\n${p.body.trim()}\n`;
}

export function sections(body: string): Section[] {
  const out: Section[] = [];
  let cur: Section | undefined;
  for (const line of body.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      cur = { heading: h[1]!.trim(), text: "" };
      out.push(cur);
    } else if (cur) cur.text += `${line}\n`;
  }
  for (const s of out) s.text = s.text.trim();
  return out;
}

export function links(body: string): string[] {
  return [...new Set([...body.matchAll(LINK_RE)].map((m) => m[1]!))];
}

export interface WikiChange {
  slug: string;
  deleted?: boolean;
}

export class Wiki {
  private pages = new Map<string, Page>();
  private watcher: FSWatcher | undefined;
  /** Set while the wiki writes its own files, so the watcher ignores them. */
  private selfWrite = 0;
  onChange?: (c: WikiChange[]) => void;

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    const pages = new Map<string, Page>();
    for (const type of PAGE_TYPES) {
      const d = join(this.dir, DIR[type]);
      if (!existsSync(d)) continue;
      for (const f of await readdir(d)) {
        const slug = f.replace(/\.md$/, "");
        if (!f.endsWith(".md") || !SLUG.test(slug)) continue;
        try {
          const p = parsePage(slug, await readFile(join(d, f), "utf8"));
          if (p.type !== type) p.type = type;
          pages.set(slug, p);
        } catch {
          // Malformed page (manual edit): skipped until fixed; lint reports it.
        }
      }
    }
    this.pages = pages;
  }

  /** Reloads on manual edits (spec §10.8); debounced. */
  watch(): void {
    let timer: NodeJS.Timeout | undefined;
    this.watcher = watch(this.dir, { recursive: true }, (_ev, file) => {
      if (this.selfWrite > 0 || !file || !/^(entities|concepts)\/[a-z0-9-]+\.md$/.test(String(file))) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.load().then(() => this.onChange?.([]));
      }, 200);
    });
  }

  close(): void {
    this.watcher?.close();
  }

  get(slug: string): Page | undefined {
    return this.pages.get(slug);
  }

  list(): Page[] {
    return [...this.pages.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** Creates or replaces a page; validates frontmatter, slug and size; keeps `created`. */
  async write(slug: string, meta: z.input<typeof pageMeta>, body: string): Promise<Page> {
    if (!SLUG.test(slug)) throw new Error(`invalid slug ${slug}`);
    const parsed = pageMeta.parse(meta);
    const prev = this.pages.get(slug);
    const page: Page = { ...parsed, slug, body, created: prev?.created ?? parsed.created ?? today(), updated: today() };
    const text = serializePage(page);
    if (Buffer.byteLength(text) > MAX_PAGE_BYTES) {
      throw new Error(`page ${slug} is ${Buffer.byteLength(text)} bytes (max ${MAX_PAGE_BYTES}); split it into sub-pages`);
    }
    await this.selfWriting(async () => {
      if (prev && prev.type !== page.type) await unlink(this.path(prev)).catch(() => {});
      await mkdir(join(this.dir, DIR[page.type]), { recursive: true });
      await writeFile(this.path(page), text);
    });
    this.pages.set(slug, page);
    this.onChange?.([{ slug }]);
    return page;
  }

  /** Replaces (or appends to) one H2 section; creates the section if missing. */
  async patchSection(slug: string, heading: string, content: string, mode: "replace" | "append" = "replace"): Promise<Page> {
    const p = this.require(slug);
    const lines = p.body.split("\n");
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) {
      return this.write(slug, p, `${p.body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`);
    }
    let end = start + 1;
    while (end < lines.length && !/^## /.test(lines[end]!)) end++;
    const old = lines.slice(start + 1, end).join("\n").trim();
    const next = mode === "append" && old ? `${old}\n${content.trim()}` : content.trim();
    lines.splice(start + 1, end - start - 1, "", next, "");
    return this.write(slug, p, lines.join("\n"));
  }

  /** Renames a slug; rewrites `[[links]]` in every page. */
  async rename(from: string, to: string): Promise<Page> {
    const p = this.require(from);
    if (this.pages.has(to)) throw new Error(`slug ${to} exists`);
    if (!SLUG.test(to)) throw new Error(`invalid slug ${to}`);
    const next = await this.write(to, p, p.body);
    await this.remove(from);
    await this.rewriteLinks(from, to);
    return next;
  }

  /** Merges `from` into `into`: aliases, sources, facts and body sections; deletes `from`. */
  async merge(from: string, into: string): Promise<Page> {
    const a = this.require(from);
    const b = this.require(into);
    const uniq = (xs: string[]) => [...new Set(xs)];
    const extra = sections(a.body)
      .filter((s) => s.text && s.heading !== "Summary")
      .map((s) => `## ${s.heading} (from ${a.title})\n\n${s.text}`)
      .join("\n\n");
    const merged = await this.write(
      into,
      {
        ...b,
        aliases: uniq([...b.aliases, a.title, ...a.aliases]).filter((x) => x !== b.title),
        sources: uniq([...b.sources, ...a.sources]),
        facts: uniq([...b.facts, ...a.facts]),
      },
      extra ? `${b.body.trimEnd()}\n\n${extra}\n` : b.body,
    );
    await this.remove(from);
    await this.rewriteLinks(from, into);
    return merged;
  }

  async delete(slug: string): Promise<void> {
    this.require(slug);
    await this.remove(slug);
  }

  /** Pages linking to `slug`. */
  backlinks(slug: string): string[] {
    return this.list()
      .filter((p) => p.slug !== slug && links(p.body).includes(slug))
      .map((p) => p.slug);
  }

  unresolvedLinks(): Array<{ slug: string; missing: string[] }> {
    const out: Array<{ slug: string; missing: string[] }> = [];
    for (const p of this.list()) {
      const missing = links(p.body).filter((l) => !this.pages.has(l));
      if (missing.length) out.push({ slug: p.slug, missing });
    }
    return out;
  }

  /** `index.md` lines: `- [[slug]] (kind) — summary`, grouped by type, sorted by slug. */
  indexLines(filter: { type?: PageType; kind?: string } = {}): string[] {
    const out: string[] = [];
    for (const type of PAGE_TYPES) {
      if (filter.type && filter.type !== type) continue;
      const pages = this.list().filter((p) => p.type === type && (!filter.kind || p.kind === filter.kind));
      if (!pages.length) continue;
      out.push(`## ${type === "entity" ? "Entities" : "Concepts"}`);
      for (const p of pages) out.push(`- [[${p.slug}]] (${p.kind}) — ${p.summary}`);
    }
    return out;
  }

  async writeIndex(path: string): Promise<void> {
    await this.selfWriting(() => writeFile(path, `# Index\n\n${this.indexLines().join("\n")}\n`));
  }

  private async remove(slug: string): Promise<void> {
    const p = this.pages.get(slug);
    if (!p) return;
    await this.selfWriting(() => unlink(this.path(p)).catch(() => {}));
    this.pages.delete(slug);
    this.onChange?.([{ slug, deleted: true }]);
  }

  private async rewriteLinks(from: string, to: string): Promise<void> {
    for (const p of this.list()) {
      if (!links(p.body).includes(from)) continue;
      await this.write(p.slug, p, p.body.replaceAll(`[[${from}]]`, `[[${to}]]`));
    }
  }

  private require(slug: string): Page {
    const p = this.pages.get(slug);
    if (!p) throw new Error(`no page ${slug}`);
    return p;
  }

  private path(p: Pick<Page, "type" | "slug">): string {
    return join(this.dir, DIR[p.type], `${p.slug}.md`);
  }

  private async selfWriting<T>(fn: () => Promise<T>): Promise<T> {
    this.selfWrite++;
    try {
      return await fn();
    } finally {
      // fs.watch events arrive after the write returns.
      setTimeout(() => this.selfWrite--, 100);
    }
  }
}
