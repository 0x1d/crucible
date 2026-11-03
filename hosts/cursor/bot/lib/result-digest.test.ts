import assert from "node:assert/strict";
import test from "node:test";

import {
  ARRAY_SAMPLE_COUNT,
  presentResult,
  serialized,
  STRING_HEAD,
} from "./result-digest.ts";

const saved = "/session/artifacts/result.json";

function containers(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id${index}`,
    name: `container-${index}`,
    image: index % 3 === 0 ? "node:24" : "postgres:16",
    status: "Up 1 hour",
    state: "running",
    ports: "",
    created: "1 hour ago",
    command: "docker-entrypoint",
    project: "demo",
  }));
}

function listing(count: number): Record<string, unknown> {
  const rows = containers(count);
  return {
    function: "docker.ps",
    ok: true,
    result: { all: true, count, containers: rows },
  };
}

function fileRead(body: string): Record<string, unknown> {
  return {
    function: "fs.read",
    ok: true,
    result: {
      path: "/tmp/alchemist-ctx-eval/payload.txt",
      content: body,
      size: body.length,
      truncated: false,
      max_bytes: null,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  return value as Record<string, unknown>;
}

test("a small tool result stays inline", () => {
  const result = { ok: true, result: { echoed: true } };
  const presented = presentResult(result, saved);
  assert.equal(presented.replace, false);
});

test("a bulky array becomes a count, field names, and two samples", () => {
  const result = listing(60);
  const original = serialized(result);
  assert.ok(original !== undefined && original.length > 8_000);
  const presented = presentResult(result, saved);
  assert.equal(presented.replace, true);
  if (!presented.replace) return;
  const value = asRecord(presented.value);
  assert.equal(value.truncated, true);
  assert.equal(value.bytes, original.length);
  assert.equal(value.path, saved);
  const packed = serialized(presented.value);
  assert.ok(packed !== undefined && packed.length < original.length / 2);
  const digest = asRecord(value.digest);
  const containersNode = findArray(digest);
  assert.ok(containersNode !== undefined);
  assert.equal(containersNode.length, 60);
  assert.equal(containersNode.sample.length, ARRAY_SAMPLE_COUNT);
  assert.ok(containersNode.fields.includes("image"));
  assert.ok(containersNode.fields.includes("name"));
  assert.equal(packed.includes("container-10"), false);
  assert.equal(String(value.head).includes("array length 60"), true);
});

test("a named file body under the old cap stays inline", () => {
  const marker = "autocompact";
  const body = `${"intro\n".repeat(400)}${marker}\n${"tail line\n".repeat(1_400)}`;
  assert.ok(body.length > 8_000 && body.length < 32_768);
  const result = fileRead(body);
  const presented = presentResult(result, saved);
  assert.equal(presented.replace, false);
  const text = serialized(result);
  assert.ok(text !== undefined && text.includes(marker));
});

test("an oversized file body keeps a short head and tail", () => {
  const line = "LARGE_PAYLOAD_MARKER padding so this tool result exceeds the host cap.\n";
  const middle = "MIDDLE_SECRET_MARKER";
  const body = `${line.repeat(800)}${middle}${line.repeat(800)}`;
  assert.ok(body.length > 32_768);
  const result = fileRead(body);
  const presented = presentResult(result, saved);
  assert.equal(presented.replace, true);
  if (!presented.replace) return;
  const value = asRecord(presented.value);
  assert.equal(value.truncated, true);
  assert.equal(String(value.head).startsWith("LARGE_PAYLOAD_MARKER"), true);
  assert.equal(String(value.head).includes(middle), false);
  assert.equal(String(value.tail).includes("LARGE_PAYLOAD_MARKER"), true);
  const content = findString(asRecord(value.digest));
  assert.ok(content !== undefined);
  assert.equal(content.chars, body.length);
  assert.equal(content.head.length, STRING_HEAD);
  assert.equal(content.head.startsWith("LARGE_PAYLOAD_MARKER"), true);
  const packed = serialized(presented.value);
  assert.ok(packed !== undefined && packed.includes(middle) === false);
  assert.ok(packed !== undefined && packed.length < 8_000);
});

type ArrayNode = { length: number; sample: unknown[]; fields: string[] };
type StringNode = { chars: number; head: string; tail: string };

function findArray(value: unknown): ArrayNode | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArray(item);
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
      fields: record.fields.filter((field) => typeof field === "string"),
    };
  }
  for (const child of Object.values(record)) {
    const found = findArray(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findString(value: unknown): StringNode | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "string" &&
    typeof record.chars === "number" &&
    typeof record.head === "string" &&
    typeof record.tail === "string"
  ) {
    return { chars: record.chars, head: record.head, tail: record.tail };
  }
  for (const child of Object.values(record)) {
    const found = findString(child);
    if (found !== undefined) return found;
  }
  return undefined;
}
