// In-memory BM25 search over wiki pages (spec 10 §10.3.2) and fact texts.
import type { Fact } from "./temporal.js";
import { sections, type Page } from "./wiki.js";

export interface SearchResult {
  slug: string;
  title: string;
  kind: string;
  summary: string;
  /** H2 headings of sections that contain a query term. */
  sections: string[];
  score: number;
}

const STOP = new Set(
  "a an and are as at be by did do does for from has have how i in is it its me my of on or our that the their them they this to was we what when where which who why will with you your".split(
    " ",
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOP.has(t));
}

interface Doc {
  page: Page;
  tf: Map<string, number>;
  len: number;
}

const K1 = 1.2;
const B = 0.75;

export class SearchIndex {
  private docs = new Map<string, Doc>();
  private df = new Map<string, number>();
  private totalLen = 0;

  rebuild(pages: Page[]): void {
    this.docs.clear();
    this.df.clear();
    this.totalLen = 0;
    for (const p of pages) this.add(p);
  }

  /** Re-indexes one page (undefined = removed). */
  update(slug: string, page: Page | undefined): void {
    this.remove(slug);
    if (page) this.add(page);
  }

  search(query: string, limit = 8): SearchResult[] {
    const q = [...new Set(tokens(query))];
    if (!q.length || !this.docs.size) return [];
    const n = this.docs.size;
    const avg = this.totalLen / n;
    const scored: SearchResult[] = [];
    for (const d of this.docs.values()) {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg));
      }
      if (score <= 0) continue;
      const hit = sections(d.page.body)
        .filter((s) => tokens(`${s.heading} ${s.text}`).some((t) => q.includes(t)))
        .map((s) => s.heading);
      scored.push({
        slug: d.page.slug,
        title: d.page.title,
        kind: d.page.kind,
        summary: d.page.summary,
        sections: hit,
        score: Math.round(score * 1000) / 1000,
      });
    }
    return scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)).slice(0, Math.min(limit, 20));
  }

  private add(p: Page): void {
    // Field weights by repetition: title, aliases ×3; summary, headings ×2; body ×1.
    const heads = sections(p.body).map((s) => s.heading);
    const all = [
      ...rep(tokens([p.title, p.slug.replace(/-/g, " "), ...p.aliases].join(" ")), 3),
      ...rep(tokens([p.summary, ...heads].join(" ")), 2),
      ...tokens(p.body),
    ];
    const tf = new Map<string, number>();
    for (const t of all) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.set(p.slug, { page: p, tf, len: all.length });
    this.totalLen += all.length;
  }

  private remove(slug: string): void {
    const d = this.docs.get(slug);
    if (!d) return;
    for (const t of d.tf.keys()) {
      const v = (this.df.get(t) ?? 1) - 1;
      if (v > 0) this.df.set(t, v);
      else this.df.delete(t);
    }
    this.totalLen -= d.len;
    this.docs.delete(slug);
  }
}

function rep<T>(xs: T[], n: number): T[] {
  return Array.from({ length: n }, () => xs).flat();
}

/** Facts whose text (or topic, value, title) shares terms with the query, best first. */
export function searchFacts(facts: Fact[], query: string, limit = 8): Fact[] {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  return facts
    .map((f) => {
      const t = new Set(tokens([f.text, f.subject, ...Object.values(f.attrs).flat().map(String)].join(" ")));
      let hits = 0;
      for (const x of q) if (t.has(x)) hits++;
      return { f, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.f.valid_from.localeCompare(a.f.valid_from))
    .slice(0, limit)
    .map((x) => x.f);
}
