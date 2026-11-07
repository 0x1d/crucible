import type { TSchema } from "@sinclair/typebox";
import { DeviceMessages, HDP_VERSION, ServerMessages } from "../src/messages.js";

const defKey = (dir: "device" | "server", s: TSchema) => `${dir}.${s.properties.type.const as string}`;

/** Strips TypeBox symbol keys by round-tripping through JSON. */
const plain = (s: TSchema): unknown => JSON.parse(JSON.stringify(s));

export function buildSchemaDocument() {
  const $defs: Record<string, unknown> = {};
  for (const s of DeviceMessages) $defs[defKey("device", s)] = plain(s);
  for (const s of ServerMessages) $defs[defKey("server", s)] = plain(s);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://homunculus.local/protocol/hdp.v1.schema.json",
    title: `Homunculus Device Protocol HDP/${HDP_VERSION} control messages`,
    description:
      "Generated from protocol/src/messages.ts. One text frame = one message. Unknown types and unknown fields must be ignored.",
    $defs,
    anyOf: [
      { title: "Device to server", oneOf: DeviceMessages.map((s) => ({ $ref: `#/$defs/${defKey("device", s)}` })) },
      { title: "Server to device", oneOf: ServerMessages.map((s) => ({ $ref: `#/$defs/${defKey("server", s)}` })) },
    ],
  };
}
