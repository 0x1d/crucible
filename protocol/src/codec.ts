// JSON control message parsing and validation (spec §4.5, §4.8).
import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import {
  DeviceMessages,
  ServerMessages,
  type DeviceMessage,
  type ServerMessage,
} from "./messages.js";

export type ParseResult<M> =
  | { ok: true; message: M }
  /** Unknown `type`: must be ignored (forward compatibility). */
  | { ok: false; kind: "unknown"; type: string }
  | { ok: false; kind: "invalid"; error: string };

function compileByType(schemas: readonly TSchema[]): Map<string, TypeCheck<TSchema>> {
  const map = new Map<string, TypeCheck<TSchema>>();
  for (const s of schemas) map.set(s.properties.type.const as string, TypeCompiler.Compile(s));
  return map;
}

const deviceChecks = compileByType(DeviceMessages);
const serverChecks = compileByType(ServerMessages);

function parse<M>(checks: Map<string, TypeCheck<TSchema>>, input: string | unknown): ParseResult<M> {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (e) {
      return { ok: false, kind: "invalid", error: `malformed JSON: ${(e as Error).message}` };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, kind: "invalid", error: "message is not a JSON object" };
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return { ok: false, kind: "invalid", error: "missing string field 'type'" };
  const check = checks.get(type);
  if (!check) return { ok: false, kind: "unknown", type };
  if (!check.Check(value)) {
    const first = check.Errors(value).First();
    return {
      ok: false,
      kind: "invalid",
      error: `${type}: ${first ? `${first.path || "/"} ${first.message}` : "schema mismatch"}`,
    };
  }
  return { ok: true, message: value as M };
}

/** Parse a device → server text frame. */
export function parseDeviceMessage(input: string | unknown): ParseResult<DeviceMessage> {
  return parse(deviceChecks, input);
}

/** Parse a server → device text frame. */
export function parseServerMessage(input: string | unknown): ParseResult<ServerMessage> {
  return parse(serverChecks, input);
}

/** Narrow a message union by its `type` field. */
export type MessageOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;
