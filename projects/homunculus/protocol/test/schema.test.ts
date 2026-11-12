import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSchemaDocument } from "../scripts/schema-document.js";

test("schemas/hdp.v1.schema.json is up to date", () => {
  const committed = readFileSync(new URL("../schemas/hdp.v1.schema.json", import.meta.url), "utf8");
  assert.equal(committed, `${JSON.stringify(buildSchemaDocument(), null, 2)}\n`, "run `pnpm gen:schema`");
});
