import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AcpHarnessFs } from "./harness.ts";

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acp-harness-")));
  const root = path.join(base, "root");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, "secret.txt"), "secret");
  return { base, root, harness: new AcpHarnessFs(() => [root]) };
}

test("read returns a 1-based line range", async () => {
  const { root, harness } = setup();
  const file = path.join(root, "a.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  assert.equal(await harness.read(file), "one\ntwo\nthree\n");
  assert.equal(await harness.read(file, 2, 1), "two");
});

test("write creates parent directories inside a root", async () => {
  const { root, harness } = setup();
  const file = path.join(root, "new/dir/a.txt");
  await harness.write(file, "hi");
  assert.equal(fs.readFileSync(file, "utf8"), "hi");
});

test("paths outside the roots are refused", async () => {
  const { base, root, harness } = setup();
  await assert.rejects(harness.read(path.join(base, "secret.txt")), /Invalid params/i);
  await assert.rejects(harness.read(path.join(root, "../secret.txt")), /Invalid params/i);
  await assert.rejects(harness.write(path.join(base, "x.txt"), "x"), /Invalid params/i);
  await assert.rejects(harness.read("relative.txt"), /Invalid params/i);
});

test("a symlink cannot leave the roots", async () => {
  const { base, root, harness } = setup();
  fs.symlinkSync(base, path.join(root, "out"));
  await assert.rejects(harness.read(path.join(root, "out/secret.txt")), /Invalid params/i);
  await assert.rejects(harness.write(path.join(root, "out/new.txt"), "x"), /Invalid params/i);
  assert.equal(fs.existsSync(path.join(base, "new.txt")), false);
});

test("a missing file is reported as not found", async () => {
  const { root, harness } = setup();
  await assert.rejects(harness.read(path.join(root, "nope.txt")), /not found/i);
});
