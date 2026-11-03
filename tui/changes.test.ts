import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ChangeTracker } from "./changes.ts";

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-changes-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "functions/a"), { recursive: true });
  fs.writeFileSync(path.join(dir, "functions/a/tool.ex"), "one\ntwo\n");
  fs.writeFileSync(path.join(dir, "outside.txt"), "x\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}

test("a clean tree reports no changes", async () => {
  const tracker = await ChangeTracker.start(makeRepo());
  assert.deepEqual(await tracker.refresh(), []);
});

test("an edited file reports its line counts", async () => {
  const root = makeRepo();
  const tracker = await ChangeTracker.start(root);
  fs.writeFileSync(path.join(root, "functions/a/tool.ex"), "one\nTWO\nthree\n");
  assert.deepEqual(await tracker.refresh(), [
    { path: "functions/a/tool.ex", added: 2, removed: 1 },
  ]);
});

test("a new untracked file counts all lines as added", async () => {
  const root = makeRepo();
  const tracker = await ChangeTracker.start(root);
  fs.mkdirSync(path.join(root, "functions/b"));
  fs.writeFileSync(path.join(root, "functions/b/meta.json"), "{\n}\n");
  assert.deepEqual(await tracker.refresh(), [
    { path: "functions/b/meta.json", added: 2, removed: 0 },
  ]);
});

test("a second edit with the same counts still reports a change", async () => {
  const root = makeRepo();
  const tracker = await ChangeTracker.start(root);
  const file = path.join(root, "functions/a/tool.ex");
  fs.writeFileSync(file, "one\nTWO\n");
  await tracker.refresh();
  fs.writeFileSync(file, "one\nZWEI\n");
  assert.equal((await tracker.refresh()).length, 1);
});

test("files outside functions/ are ignored", async () => {
  const root = makeRepo();
  const tracker = await ChangeTracker.start(root);
  fs.writeFileSync(path.join(root, "outside.txt"), "y\n");
  assert.deepEqual(await tracker.refresh(), []);
});

test("changes that exist at start are not reported", async () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, "functions/a/tool.ex"), "dirty\n");
  const tracker = await ChangeTracker.start(root);
  assert.deepEqual(await tracker.refresh(), []);
});

test("diff covers the changed paths, including new files", async () => {
  const root = makeRepo();
  const tracker = await ChangeTracker.start(root);
  fs.writeFileSync(path.join(root, "functions/a/tool.ex"), "one\nTWO\n");
  fs.writeFileSync(path.join(root, "functions/a/new.ex"), "fresh\n");
  await tracker.refresh();
  const diff = await tracker.diff();
  assert.match(diff, /^-two$/m);
  assert.match(diff, /^\+TWO$/m);
  assert.match(diff, /^\+fresh$/m);
});

test("diff is empty when nothing changed", async () => {
  const tracker = await ChangeTracker.start(makeRepo());
  assert.equal(await tracker.diff(), "");
});
