/**
 * Every memory example in the host instructions must run.
 *
 * The ```json blocks under "### Examples" are executed in order, as
 * call_function inputs, against a fresh BEAM and memory graph per file.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCodexOp, stopRuntime } from "../core/elixir-bridge.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = ["claude/instructions.md", "cursor/bot/instructions.md"];

type Example = { name: string; args: Record<string, unknown> };

function examples(file: string): Example[] {
  const text = fs.readFileSync(path.join(here, file), "utf8");
  const start = text.indexOf("### Examples");
  assert.ok(start >= 0, `${file} has no ### Examples section`);
  const section = text.slice(start).split(/\n## /)[0];
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.map((block) => {
    const parsed = JSON.parse(block.replaceAll("<session id>", "ses_example")) as Example;
    assert.equal(typeof parsed.name, "string", block);
    return parsed;
  });
}

for (const file of files) {
  test(`${file} memory examples run`, { timeout: 180_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-examples-"));
    process.env.ALCHEMIST_STATE_DIR = dir;
    process.env.AGENT_MEMORY_PATH = path.join(dir, "minigraf.graph");
    try {
      const list = examples(file);
      const names = new Set(list.map((example) => example.name));
      for (const name of [
        "memory.overview",
        "memory.query",
        "memory.remember",
        "memory.transact",
        "memory.retract",
        "memory.by_session",
      ]) {
        assert.ok(names.has(name), `${file} has no ${name} example`);
      }
      for (const example of list) {
        const result = (await runCodexOp({ op: "call", name: example.name, args: example.args })) as {
          ok?: boolean;
        };
        assert.equal(result.ok, true, `${example.name} ${JSON.stringify(example.args)}\n-> ${JSON.stringify(result)}`);
      }
    } finally {
      await stopRuntime();
    }
  });
}
