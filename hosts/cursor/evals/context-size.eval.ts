import { mkdirSync, writeFileSync } from "node:fs";

import { defineEval, includes, satisfies } from "@grok/agent-sdk/evals";
import type { SessionEvent } from "@grok/agent-sdk";

/**
 * Fresh named-file read, one turn.
 * After the prompt shrink this measured 25,743 input tokens, including this plan.
 * 32,000 leaves slack for cache variance and for later edits to the plan.
 * A search before the read measured 62,802 and does not fit.
 * A document body under 32,768 characters stays inline.
 * Before the digest notes, this file measured 26,270. With the notes, it measured 26,720.
 */
export const NAMED_READ_INPUT_TOKEN_BUDGET = 32_000;

/**
 * A ~140 KB payload.
 * A 400-character head and a 200-character tail measured 21,334.
 * A 4,000-character head measured 22,317.
 * The uncapped read measured 119,237.
 * A string digest (size, 400-character head, 200-character tail) measured 21,556.
 */
export const LARGE_READ_INPUT_TOKEN_BUDGET = 24_000;

/**
 * `docker.ps_report` for every container on this machine.
 * The full listing measured 17,490 input tokens.
 * The summary measured 14,728. This budget sits between them.
 * The summary stays under the digest floor. A later run measured 14,620.
 */
export const DOCKER_REPORT_INPUT_TOKEN_BUDGET = 16_500;

/**
 * Full `docker.ps` on this machine (about 11 KB, 45 containers).
 * Inlined, that listing measured 17,848 input tokens.
 * The array digest measured 14,256.
 * This budget sits below the inlined listing and above the digest.
 */
export const STRUCTURED_LIST_INPUT_TOKEN_BUDGET = 16_500;

const NAMED_READ_PROMPT =
  "read  docs/internal/plans/2026-11-03-cursor-host-context.md";

const LARGE_PAYLOAD = "/tmp/alchemist-ctx-eval/payload.txt";

type TurnUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

function usageOf(events: readonly SessionEvent[]): TurnUsage | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "turn.completed") continue;
    const usage = event.data.usage;
    if (usage === undefined) continue;
    return {
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    };
  }
  return undefined;
}

function recordUsage(
  t: {
    metric(name: string, value: string | number): void;
  },
  events: readonly SessionEvent[],
  toolCalls: readonly string[],
): number {
  const usage = usageOf(events);
  const inputTokens = usage?.inputTokens ?? -1;
  const cacheReadTokens = usage?.cacheReadTokens ?? -1;
  const cacheWriteTokens = usage?.cacheWriteTokens ?? -1;
  const cached = Math.max(0, cacheReadTokens) + Math.max(0, cacheWriteTokens);
  const newTokens = inputTokens >= cached ? inputTokens - cached : inputTokens;
  t.metric("inputTokens", inputTokens);
  t.metric("cacheReadTokens", cacheReadTokens);
  t.metric("cacheWriteTokens", cacheWriteTokens);
  t.metric("newTokens", newTokens);
  t.metric("toolCalls", toolCalls.length);
  return inputTokens;
}

/**
 * A harness digest of a long object array: `truncated`, a real `bytes` count,
 * and one array node whose sample is shorter than the array.
 * An inlined listing is about `bytes` long and has no such node.
 */
function isListingDigest(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (parsed === null || typeof parsed !== "object") return false;
  const record = parsed as { truncated?: unknown; bytes?: unknown };
  if (record.truncated !== true || typeof record.bytes !== "number") return false;
  if (record.bytes < 8_000 || text.length >= record.bytes / 2) return false;
  const node = findCollapsedArray(parsed);
  return (
    node !== undefined &&
    node.length >= 8 &&
    node.sample.length === 2 &&
    node.sample.length < node.length &&
    node.fields.includes("image") &&
    node.fields.includes("name")
  );
}

function isOversizedStringDigest(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text.includes('"truncated":true') || !text.includes("LARGE_PAYLOAD_MARKER")) return false;
  if (text.length >= 8_000) return false;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  const node = findStringDigest(parsed);
  return (
    node !== undefined &&
    node.chars > 32_768 &&
    node.head.startsWith("LARGE_PAYLOAD_MARKER")
  );
}

function findStringDigest(value: unknown): { chars: number; head: string } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringDigest(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "string" &&
    typeof record.chars === "number" &&
    typeof record.head === "string"
  ) {
    return { chars: record.chars, head: record.head };
  }
  for (const child of Object.values(record)) {
    const found = findStringDigest(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findCollapsedArray(
  value: unknown,
): { length: number; sample: unknown[]; fields: string[] } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCollapsedArray(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "array" &&
    typeof record.length === "number" &&
    Array.isArray(record.sample) &&
    Array.isArray(record.fields)
  ) {
    return {
      length: record.length,
      sample: record.sample,
      fields: record.fields.filter((field): field is string => typeof field === "string"),
    };
  }
  for (const child of Object.values(record)) {
    const found = findCollapsedArray(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

export default defineEval({
  tags: ["context"],
  description:
    "Named reads, large reads, and a structured listing stay within their input-token budgets.",
  timeoutMs: 180_000,
  cases: [
    {
      id: "named-read",
      description: "One fs.read of a named repo file stays under 32k input tokens.",
      async test(t) {
        const turn = await t.send(NAMED_READ_PROMPT);
        const inputTokens = recordUsage(t, turn.events, turn.toolCalls);
        t.succeeded();
        t.notCalledTool("find_function");
        t.calledTool("call_function", {
          input: { name: "fs.read" },
          count: 1,
        });
        t.maxToolCalls(1);
        t.check(
          inputTokens,
          satisfies(
            (value) =>
              typeof value === "number" &&
              value >= 0 &&
              value <= NAMED_READ_INPUT_TOKEN_BUDGET,
            `input tokens <= ${NAMED_READ_INPUT_TOKEN_BUDGET}`,
          ),
        );
        t.check(t.reply, includes(/autocompact/i));
      },
    },
    {
      id: "large-read",
      description: "A large fs.read returns a string digest and stays under 24k input tokens.",
      async test(t) {
        mkdirSync("/tmp/alchemist-ctx-eval", { recursive: true });
        writeFileSync(
          LARGE_PAYLOAD,
          "LARGE_PAYLOAD_MARKER padding so this tool result exceeds the host cap.\n".repeat(
            2_000,
          ),
        );
        const turn = await t.send(`read ${LARGE_PAYLOAD}`);
        const inputTokens = recordUsage(t, turn.events, turn.toolCalls);
        t.succeeded();
        t.notCalledTool("find_function");
        t.calledTool("call_function", {
          input: { name: "fs.read" },
          count: 1,
          output: (value) => isOversizedStringDigest(value),
        });
        t.maxToolCalls(1);
        t.check(
          inputTokens,
          satisfies(
            (value) =>
              typeof value === "number" &&
              value >= 0 &&
              value <= LARGE_READ_INPUT_TOKEN_BUDGET,
            `input tokens <= ${LARGE_READ_INPUT_TOKEN_BUDGET}`,
          ),
        );
        t.check(t.reply, includes(/LARGE_PAYLOAD_MARKER/));
      },
    },
    {
      id: "docker-report",
      description: "docker.ps_report returns a short overview, not the container list.",
      async test(t) {
        const turn = await t.send(
          [
            "Call call_function exactly once with this JSON:",
            '{"name":"docker.ps_report","args":{"all":true}}.',
            "Then reply with the container count and the image name that appears most often.",
            "Do not call any other tool.",
          ].join(" "),
        );
        const inputTokens = recordUsage(t, turn.events, turn.toolCalls);
        t.succeeded();
        t.notCalledTool("find_function");
        t.calledTool("call_function", {
          input: { name: "docker.ps_report", args: { all: true } },
          count: 1,
          output: (value) => {
            const text = typeof value === "string" ? value : JSON.stringify(value);
            return text.includes('"by_image"') && !text.includes('"containers"');
          },
        });
        t.maxToolCalls(1);
        t.check(
          inputTokens,
          satisfies(
            (value) =>
              typeof value === "number" &&
              value >= 0 &&
              value <= DOCKER_REPORT_INPUT_TOKEN_BUDGET,
            `input tokens <= ${DOCKER_REPORT_INPUT_TOKEN_BUDGET}`,
          ),
        );
        t.check(t.reply, includes(/\d+/));
      },
    },
    {
      id: "structured-list",
      description: "docker.ps comes back as a short array digest under 16.5k input tokens.",
      async test(t) {
        const turn = await t.send(
          [
            "Call call_function exactly once with this JSON:",
            '{"name":"docker.ps","args":{"all":true}}.',
            "Then reply with the container count.",
            "Do not call any other tool.",
            "Do not read an artifact path.",
          ].join(" "),
        );
        const inputTokens = recordUsage(t, turn.events, turn.toolCalls);
        t.succeeded();
        t.notCalledTool("find_function");
        t.calledTool("call_function", {
          input: { name: "docker.ps", args: { all: true } },
          count: 1,
          output: (value) => isListingDigest(value),
        });
        t.maxToolCalls(1);
        t.check(
          inputTokens,
          satisfies(
            (value) =>
              typeof value === "number" &&
              value >= 0 &&
              value <= STRUCTURED_LIST_INPUT_TOKEN_BUDGET,
            `input tokens <= ${STRUCTURED_LIST_INPUT_TOKEN_BUDGET}`,
          ),
        );
        t.check(t.reply, includes(/\d+/));
      },
    },
  ],
});
