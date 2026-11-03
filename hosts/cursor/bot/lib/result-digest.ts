/**
 * Shape digest for large `call_function` results.
 *
 * Small results stay whole.
 * A single document body at or under the old character cap stays whole.
 * A bulky array becomes a count, field names, and a few samples.
 * An oversized string becomes its size plus a short head and tail.
 * The caller stores the original JSON beside the digest.
 */

/** Results at or under this size stay inline. */
export const DIGEST_MIN_CHARS = 8_000;

/**
 * A single string body at or under this size stays inline.
 * This is the previous raw-slice cap.
 */
export const FILE_BODY_INLINE_MAX = 32_768;

/** An array at least this long, serialized, is bulky. */
export const BULKY_ARRAY_CHARS = 4_000;

export const STRING_HEAD = 400;
export const STRING_TAIL = 200;
export const ARRAY_SAMPLE_COUNT = 2;

const STRING_INLINE_MAX = 500;
const VALUE_INLINE_MAX = 800;
const FIELD_SCAN_LIMIT = 20;
const HEAD_FIELD_LIMIT = 12;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type StringDigest = {
  type: "string";
  chars: number;
  head: string;
  tail: string;
};

export type ArrayDigest = {
  type: "array";
  length: number;
  fields?: string[];
  sample: Digest[];
};

export type ObjectDigest = {
  type: "object";
  keys: string[];
  fields: { [key: string]: Digest };
};

export type Digest = Json | StringDigest | ArrayDigest | ObjectDigest;

export type DigestedResult = {
  truncated: true;
  bytes: number;
  path: string;
  digest: Digest;
  head: string;
  tail: string;
};

export type Presented =
  | { replace: false }
  | { replace: true; text: string; value: DigestedResult | SliceResult };

type SliceResult = {
  truncated: true;
  bytes: number;
  path: string;
  head: string;
  tail: string;
};

type Bulk = {
  largestString: number;
  largestArrayChars: number;
};

export function serialized(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
}

export function shouldDigest(textLength: number, value: unknown): boolean {
  if (textLength <= DIGEST_MIN_CHARS) return false;
  const bulk = measure(value);
  const singleBody =
    bulk.largestString >= textLength * 0.5 &&
    bulk.largestArrayChars < BULKY_ARRAY_CHARS &&
    textLength <= FILE_BODY_INLINE_MAX;
  if (singleBody) return false;
  if (textLength > FILE_BODY_INLINE_MAX) return true;
  return bulk.largestArrayChars >= BULKY_ARRAY_CHARS;
}

export function buildDigest(value: unknown): Digest {
  return collapse(value, true);
}

export function preview(value: unknown): { head: string; tail: string } {
  const longest = longestString(value);
  if (longest !== undefined && longest.length > STRING_INLINE_MAX) {
    return {
      head: longest.slice(0, STRING_HEAD),
      tail: longest.slice(-STRING_TAIL),
    };
  }
  const array = largestArray(value);
  if (array !== undefined && array.length > ARRAY_SAMPLE_COUNT) {
    const fields = objectFields(array);
    return { head: arrayHead(array.length, fields), tail: "" };
  }
  return { head: "", tail: "" };
}

/**
 * Decide whether `result` should be replaced, and with what.
 * `savedPath` is where the caller writes `text` when `replace` is true.
 */
export function presentResult(result: unknown, savedPath: string): Presented {
  const text = serialized(result);
  if (text === undefined || !shouldDigest(text.length, result)) {
    return { replace: false };
  }
  const digest = buildDigest(result);
  const view = preview(result);
  const digested: DigestedResult = {
    truncated: true,
    bytes: text.length,
    path: savedPath,
    digest,
    head: view.head,
    tail: view.tail,
  };
  const packed = serialized(digested);
  if (packed !== undefined && packed.length < text.length) {
    return { replace: true, text, value: digested };
  }
  if (text.length <= FILE_BODY_INLINE_MAX) return { replace: false };
  return {
    replace: true,
    text,
    value: {
      truncated: true,
      bytes: text.length,
      path: savedPath,
      head: text.slice(0, STRING_HEAD),
      tail: text.slice(-STRING_TAIL),
    },
  };
}

function measure(value: unknown): Bulk {
  const bulk: Bulk = { largestString: 0, largestArrayChars: 0 };
  walk(value, bulk);
  return bulk;
}

function walk(value: unknown, bulk: Bulk): void {
  if (typeof value === "string") {
    if (value.length > bulk.largestString) bulk.largestString = value.length;
    return;
  }
  if (Array.isArray(value)) {
    const chars = serialized(value)?.length ?? 0;
    if (chars > bulk.largestArrayChars) bulk.largestArrayChars = chars;
    for (const item of value) walk(item, bulk);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) walk(child, bulk);
  }
}

function collapse(value: unknown, force: boolean): Digest {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length <= STRING_INLINE_MAX) return value;
    return {
      type: "string",
      chars: value.length,
      head: value.slice(0, STRING_HEAD),
      tail: value.slice(-STRING_TAIL),
    };
  }
  if (Array.isArray(value)) {
    return collapseArray(value);
  }
  if (typeof value === "object") {
    const text = serialized(value);
    if (!force && text !== undefined && text.length <= VALUE_INLINE_MAX) {
      return value as Json;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const fields: { [key: string]: Digest } = {};
    for (const key of keys) {
      fields[key] = collapse(record[key], false);
    }
    return { type: "object", keys, fields };
  }
  return null;
}

function collapseArray(value: unknown[]): Digest {
  const text = serialized(value) ?? "";
  const bulky = value.length > ARRAY_SAMPLE_COUNT && text.length >= BULKY_ARRAY_CHARS;
  if (!bulky && text.length <= VALUE_INLINE_MAX) {
    return value.map((item) => collapse(item, false));
  }
  if (!bulky && value.length <= ARRAY_SAMPLE_COUNT) {
    return value.map((item) => collapse(item, false));
  }
  const fields = objectFields(value);
  const sample = value.slice(0, ARRAY_SAMPLE_COUNT).map((item) => collapse(item, false));
  const digest: ArrayDigest = { type: "array", length: value.length, sample };
  if (fields !== undefined) digest.fields = fields;
  return digest;
}

function objectFields(items: unknown[]): string[] | undefined {
  const keys = new Set<string>();
  const limit = Math.min(items.length, FIELD_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const item = items[i];
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) keys.add(key);
    }
  }
  if (keys.size === 0) return undefined;
  return [...keys].sort();
}

function longestString(value: unknown): string | undefined {
  let best: string | undefined;
  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      if (best === undefined || current.length > best.length) best = current;
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const child of Object.values(current)) visit(child);
    }
  };
  visit(value);
  return best;
}

function largestArray(value: unknown): unknown[] | undefined {
  let best: unknown[] | undefined;
  let bestChars = 0;
  const visit = (current: unknown): void => {
    if (typeof current === "string" || current === null || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      const chars = serialized(current)?.length ?? 0;
      if (chars > bestChars) {
        best = current;
        bestChars = chars;
      }
      for (const item of current) visit(item);
      return;
    }
    for (const child of Object.values(current)) visit(child);
  };
  visit(value);
  return best;
}

function arrayHead(length: number, fields: string[] | undefined): string {
  if (fields === undefined || fields.length === 0) {
    return `array length ${length}`;
  }
  const shown = fields.slice(0, HEAD_FIELD_LIMIT);
  const extra = fields.length - shown.length;
  const suffix = extra > 0 ? `,+${extra}` : "";
  return `array length ${length} fields ${shown.join(",")}${suffix}`;
}
