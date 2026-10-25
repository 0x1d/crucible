import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRegistryOp } from "./elixir-bridge.ts";

type RegistryResponse = {
  ok?: boolean;
  result?: { echoed?: boolean };
};

function asResponse(value: unknown): RegistryResponse {
  if (typeof value === "object" && value !== null) return value as RegistryResponse;
  return {};
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-bridge-"));
process.env.ALCHEMIST_STATE_DIR = stateDir;

test("registry ops share one started Erlang VM", { timeout: 180_000 }, async () => {
  const echo = await runRegistryOp({
    op: "call",
    name: "echo",
    args: { hello: "world" },
  });

  const echoBody = asResponse(echo);
  assert.equal(echoBody.ok, true);
  assert.equal(echoBody.result?.echoed, true);

  const pid = fs.readFileSync(path.join(stateDir, "pid"), "utf8").trim();
  assert.match(pid, /^\d+$/);
  assert.equal(processAlive(Number(pid)), true);

  const command = fs
    .readFileSync(`/proc/${pid}/cmdline`)
    .toString("utf8")
    .replaceAll("\0", " ");
  assert.doesNotMatch(command, /--no-start/);
  assert.doesNotMatch(command, /run_stdio/);

  const environ = fs.readFileSync(`/proc/${pid}/environ`).toString("utf8");
  assert.ok(environ.includes(stateDir));

  const found = asResponse(await runRegistryOp({ op: "find", query: "echo" }));
  assert.equal(found.ok, true);
  assert.equal(fs.readFileSync(path.join(stateDir, "pid"), "utf8").trim(), pid);
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.after(() => {
  const pidFile = path.join(stateDir, "pid");
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
});
