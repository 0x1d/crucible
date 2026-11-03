import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const botDir = path.dirname(fileURLToPath(import.meta.url));

const forbidden = [/Date\.now/, /new Date/, /\$\{/];

function scanFile(rel: string): void {
  const text = readFileSync(path.join(botDir, rel), "utf8");
  for (const pattern of forbidden) {
    assert.doesNotMatch(text, pattern, `${rel} must stay static for prompt cache (${pattern})`);
  }
}

test("instructions and tool descriptions stay static", () => {
  scanFile("instructions.md");
  for (const name of readdirSync(path.join(botDir, "tools"))) {
    if (name.endsWith(".ts")) scanFile(path.join("tools", name));
  }
});
