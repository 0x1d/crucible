// Speech Shaper (spec §5.4.2 rules 2–3): agent text deltas → speakable segments.
// Defensive markdown/URL/emoji stripping; sentence segmentation; early short first segment.

export const CODE_PLACEHOLDER = "I've put the code on the server.";

export interface ShaperOptions {
  /** First segment may end at a clause boundary once it has this many words. */
  firstMinWords: number;
  /** A first sentence longer than this is cut at its first clause boundary. */
  firstMaxWords: number;
}

const defaults: ShaperOptions = { firstMinWords: 4, firstMaxWords: 12 };

const ABBREVIATIONS = new Set(
  ["mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "e.g", "i.e", "approx", "no", "mt", "ft", "u.s", "u.k", "p.m", "a.m", "pm", "am"],
);

/** Sentence end: terminal punctuation (+ closing quotes/brackets) followed by whitespace, or a newline. */
const SENTENCE_END = /([.!?…]+["'”’)\]]*)\s+|\n+/g;
const CLAUSE_END = /[,;:]\s+|\s[—–-]\s/g;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class SpeechShaper {
  private buf = "";
  private segments = 0;
  private readonly opts: ShaperOptions;

  constructor(opts: Partial<ShaperOptions> = {}) {
    this.opts = { ...defaults, ...opts };
  }

  /** Adds agent text; returns segments that are complete. */
  push(delta: string): string[] {
    this.buf += delta;
    return this.drain(false);
  }

  /** End of agent output: returns the remaining text as segments. */
  flush(): string[] {
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    // Closed code fences become one placeholder sentence.
    this.buf = this.buf.replace(/```[\s\S]*?```/g, `\n${CODE_PLACEHOLDER}\n`);
    const out: string[] = [];
    for (;;) {
      const open = this.buf.indexOf("```");
      const region = open >= 0 ? this.buf.slice(0, open) : this.buf;
      const cut = this.boundary(region);
      if (cut === undefined) break;
      this.take(this.buf.slice(0, cut), out);
      this.buf = this.buf.slice(cut);
    }
    if (final) {
      // An unterminated fence at the end of the answer is still code.
      this.buf = this.buf.replace(/```[\s\S]*$/, `\n${CODE_PLACEHOLDER}`);
      for (const part of this.buf.split(/\n+/)) this.take(part, out);
      this.buf = "";
    }
    return out;
  }

  private take(raw: string, out: string[]): void {
    const text = cleanForSpeech(raw);
    if (text) {
      out.push(text);
      this.segments++;
    }
  }

  /** End index (exclusive) of the next complete segment in `text`, if any. */
  private boundary(text: string): number | undefined {
    let sentence: number | undefined;
    for (const m of text.matchAll(SENTENCE_END)) {
      const end = (m.index ?? 0) + m[0].length;
      if (m[1] && isAbbreviation(text, m.index ?? 0)) continue;
      if (!text.slice(0, end).trim()) continue;
      sentence = end;
      break;
    }
    if (this.segments > 0) return sentence;
    if (sentence !== undefined && words(text.slice(0, sentence)) <= this.opts.firstMaxWords) return sentence;
    // First segment: cut early at a clause boundary to minimise time to first audio.
    for (const m of text.matchAll(CLAUSE_END)) {
      const end = (m.index ?? 0) + m[0].length;
      if (sentence !== undefined && end >= sentence) break;
      if (words(text.slice(0, end)) >= this.opts.firstMinWords) return end;
    }
    return sentence;
  }
}

function isAbbreviation(text: string, dotIndex: number): boolean {
  if (text[dotIndex] !== ".") return false;
  const before = /([\p{L}.]+)$/u.exec(text.slice(0, dotIndex))?.[1]?.toLowerCase() ?? "";
  if (ABBREVIATIONS.has(before)) return true;
  if (/(^|\n)\s*\d+$/.test(text.slice(0, dotIndex))) return true; // numbered list marker
  // Decimal numbers ("3.5") are not sentence ends.
  if (/\d$/.test(text.slice(0, dotIndex)) && /^\d/.test(text.slice(dotIndex + 1))) return true;
  // Single initials ("J. R. R. Tolkien") are not sentence ends.
  return /^\p{Lu}$/u.test(text.slice(dotIndex - 1, dotIndex)) && /(^|\s)\p{Lu}$/u.test(text.slice(0, dotIndex));
}

/** Strips markdown, URLs and emoji so the TTS reads only speakable text (rule 2). */
export function cleanForSpeech(raw: string): string {
  let s = raw;
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links
  s = s.replace(/<?\bhttps?:\/\/(?:www\.)?([^\s/<>)]+)[^\s<>)]*>?/g, "$1"); // bare URLs → domain
  s = s.replace(/`([^`]*)`/g, "$1"); // inline code
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // headings
  s = s.replace(/^\s*>\s?/gm, ""); // block quotes
  s = s.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, ""); // list markers
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2"); // bold
  s = s.replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1"); // italic *x*
  s = s.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1"); // italic _x_
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ""); // table separator rows
  // Table cells: "| a | b |" → "a, b". Strip leading/trailing pipes first so clause commas are preserved.
  s = s.replace(/^\s*\|\s*|\s*\|\s*$/gm, "").replace(/\s*\|\s*/g, ", ");
  s = s.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, ""); // emoji
  s = s.replace(/[*#`]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : "";
}
