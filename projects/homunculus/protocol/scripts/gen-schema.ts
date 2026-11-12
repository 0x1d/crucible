// Writes schemas/hdp.v1.schema.json from src/messages.ts.
// `--check` exits non-zero if the committed file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSchemaDocument } from "./schema-document.js";

const path = fileURLToPath(new URL("../schemas/hdp.v1.schema.json", import.meta.url));
const json = `${JSON.stringify(buildSchemaDocument(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== json) {
    console.error("schemas/hdp.v1.schema.json is out of date; run `pnpm gen:schema`");
    process.exit(1);
  }
} else {
  writeFileSync(path, json);
  console.log(`wrote ${path}`);
}
