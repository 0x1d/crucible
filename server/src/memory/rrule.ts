// RFC 5545 RRULE expansion, subset: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL, COUNT, UNTIL,
// BYDAY (WEEKLY only). Expanded in UTC from the event's valid_from.

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_ITER = 5000;

export interface Occurrence {
  start: Date;
  end: Date;
}

export function parseRrule(rule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/, "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.toUpperCase()] = v.toUpperCase();
  }
  return out;
}

/** Occurrences of an event starting at `start` (duration `durMs`) that overlap [from, to). */
export function occurrences(start: Date, durMs: number, rule: string | undefined, from: Date, to: Date): Occurrence[] {
  const overlaps = (s: Date) => s.getTime() < to.getTime() && s.getTime() + durMs > from.getTime();
  const at = (s: Date) => ({ start: s, end: new Date(s.getTime() + durMs) });
  if (!rule) return overlaps(start) ? [at(start)] : [];
  const r = parseRrule(rule);
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseUntil(r.UNTIL) : undefined;
  const byDay = freq === "WEEKLY" && r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : [];
  const out: Occurrence[] = [];
  let n = 0;
  const emit = (s: Date): boolean => {
    if (s < start) return true;
    if ((until && s > until) || n >= count || s >= to) return false;
    n++;
    if (overlaps(s)) out.push(at(s));
    return true;
  };
  for (let i = 0; i < MAX_ITER; i++) {
    const base = step(start, freq, i * interval);
    if (!base) break;
    if (byDay.length) {
      // Week containing `base` (starting at the event's weekday), each listed day.
      const days = byDay.map((d) => (d - start.getUTCDay() + 7) % 7).sort((a, b) => a - b);
      let more = true;
      for (const d of days) if (!(more = emit(new Date(base.getTime() + d * 86_400_000)))) break;
      if (!more) break;
    } else if (!emit(base)) break;
  }
  return out;
}

function step(start: Date, freq: string | undefined, k: number): Date | undefined {
  const d = new Date(start);
  switch (freq) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + k);
      return d;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7 * k);
      return d;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + k);
      return d;
    case "YEARLY":
      d.setUTCFullYear(d.getUTCFullYear() + k);
      return d;
    default:
      return k === 0 ? d : undefined;
  }
}

function parseUntil(v: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(v);
  if (!m) return undefined;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59)));
}
