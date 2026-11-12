import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCodexOp } from "./elixir-bridge.ts";

type CodexResponse = {
  ok?: boolean;
  result?: { echoed?: boolean };
};

function asResponse(value: unknown): CodexResponse {
  if (typeof value === "object" && value !== null) return value as CodexResponse;
  return {};
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-bridge-"));
process.env.ALCHEMIST_STATE_DIR = stateDir;
// Own memory graph: the repo graph is held open by any running runtime.
process.env.AGENT_MEMORY_PATH = path.join(stateDir, "minigraf.graph");

test("codex ops share one started Erlang VM", { timeout: 180_000 }, async () => {
  const echo = await runCodexOp({
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
  assert.doesNotMatch(command, /\bmix\b/);
  assert.match(command, /elixir/);
  assert.match(command, /ensure_all_started\(:runtime, :permanent\)/);

  const environ = fs.readFileSync(`/proc/${pid}/environ`).toString("utf8");
  assert.ok(environ.includes(stateDir));

  const found = asResponse(await runCodexOp({ op: "find", query: "echo" }));
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

const bridgePath = fileURLToPath(new URL("./elixir-bridge.ts", import.meta.url));

test(
  "a dev boot stops a leftover BEAM for the same state directory",
  { timeout: 180_000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-replace-"));
    const state = path.join(dir, "state");
    const memory = path.join(dir, "mem.graph");
    const keeper = path.join(dir, "keeper.mjs");
    const replacer = path.join(dir, "replacer.mjs");
    fs.writeFileSync(
      keeper,
      `import { runCodexOp } from ${JSON.stringify(bridgePath)};
const result = await runCodexOp({ op: "call", name: "echo", args: { hello: "keep" } });
if (!result || result.ok !== true) process.exit(1);
setInterval(() => {}, 1000);
process.stdout.write("READY\\n");
`,
    );
    fs.writeFileSync(
      replacer,
      `import { runCodexOp } from ${JSON.stringify(bridgePath)};
const result = await runCodexOp({ op: "call", name: "echo", args: { hello: "replace" } });
process.stdout.write(JSON.stringify(result) + "\\n");
`,
    );
    const env = {
      ...process.env,
      ALCHEMIST_STATE_DIR: state,
      AGENT_MEMORY_PATH: memory,
      ALCHEMIST_RUNTIME_DETACHED: "0",
      ALCHEMIST_RUNTIME_NO_SHUTDOWN_HOOK: "1",
    };
    const host = spawn(process.execPath, ["--experimental-strip-types", keeper], {
      cwd: path.resolve(path.dirname(bridgePath), ".."),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let readyOut = "";
    host.stdout?.setEncoding("utf8");
    host.stderr?.setEncoding("utf8");
    host.stdout?.on("data", (chunk: string) => {
      readyOut += chunk;
    });
    host.stderr?.on("data", (chunk: string) => {
      readyOut += chunk;
    });
    let beam = 0;
    try {
      const started = Date.now();
      while (!readyOut.includes("READY")) {
        if (host.exitCode !== null || host.signalCode !== null) {
          throw new Error(`keeper exited during boot\n${readyOut}`);
        }
        if (Date.now() - started > 90_000) throw new Error(`keeper boot timed out\n${readyOut}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      beam = Number(fs.readFileSync(path.join(state, "pid"), "utf8"));
      assert.equal(processAlive(beam), true);
      for (const name of ["pid", "port", "stamp"]) {
        fs.rmSync(path.join(state, name), { force: true });
      }
      assert.equal(processAlive(beam), true);

      const replaced = spawn(process.execPath, ["--experimental-strip-types", replacer], {
        cwd: path.resolve(path.dirname(bridgePath), ".."),
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      let output = "";
      replaced.stdout?.setEncoding("utf8");
      replaced.stderr?.setEncoding("utf8");
      replaced.stdout?.on("data", (chunk: string) => {
        output += chunk;
      });
      replaced.stderr?.on("data", (chunk: string) => {
        output += chunk;
      });
      const exitCode = await new Promise<number | null>((resolve) => {
        replaced.once("exit", (code) => resolve(code));
      });
      assert.equal(exitCode, 0, output);
      assert.match(output, /"ok":true/);
      await waitUntil(() => !processAlive(beam), 8_000);
    } finally {
      try {
        const leftover = Number(fs.readFileSync(path.join(state, "pid"), "utf8"));
        if (processAlive(leftover)) process.kill(leftover, "SIGKILL");
      } catch {
        // replacement already exited
      }
      if (beam && processAlive(beam)) {
        try {
          process.kill(beam, "SIGKILL");
        } catch {
          // already gone
        }
      }
      if (host.pid && processAlive(host.pid)) {
        try {
          process.kill(host.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  },
);

test(
  "a second SIGINT or a killed owner stops the BEAM",
  { timeout: 180_000 },
  async () => {
    await withHost({ shutdownHook: true }, async ({ host, beam }) => {
      process.kill(host.pid!, "SIGINT");
      await waitUntil(() => !processAlive(beam), 8_000);
      assert.equal(processAlive(host.pid!), true);
    });

    await withHost({ shutdownHook: true }, async ({ host, beam }) => {
      process.kill(beam, "SIGSTOP");
      process.kill(host.pid!, "SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(processAlive(beam), true, "first SIGINT must not be a kill");
      const exit = new Promise<number | null>((resolve) => {
        host.once("exit", (code) => resolve(code));
      });
      process.kill(host.pid!, "SIGINT");
      assert.equal(await exit, 130);
      await waitUntil(() => !processAlive(beam), 5_000);
    });

    await withHost({ shutdownHook: false }, async ({ host, beam }) => {
      process.kill(host.pid!, "SIGKILL");
      await waitUntil(() => !processAlive(beam), 5_000);
    });
  },
);

async function withHost(
  options: { shutdownHook: boolean },
  body: (running: { host: ChildProcess; beam: number }) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemist-life-"));
  const script = path.join(dir, "host.mjs");
  fs.writeFileSync(
    script,
    `import { runCodexOp } from ${JSON.stringify(bridgePath)};
const result = await runCodexOp({ op: "call", name: "echo", args: { hello: "world" } });
if (!result || result.ok !== true) {
  console.error(JSON.stringify(result));
  process.exit(1);
}
setInterval(() => {}, 1000);
process.stdout.write("READY\\n");
`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ALCHEMIST_STATE_DIR: path.join(dir, "state"),
    AGENT_MEMORY_PATH: path.join(dir, "mem.graph"),
    ALCHEMIST_RUNTIME_DETACHED: "0",
  };
  if (options.shutdownHook) delete env.ALCHEMIST_RUNTIME_NO_SHUTDOWN_HOOK;
  else env.ALCHEMIST_RUNTIME_NO_SHUTDOWN_HOOK = "1";

  const host = spawn(process.execPath, ["--experimental-strip-types", script], {
    cwd: path.resolve(path.dirname(bridgePath), ".."),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  let output = "";
  host.stdout?.setEncoding("utf8");
  host.stderr?.setEncoding("utf8");
  host.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  host.stderr?.on("data", (chunk: string) => {
    output += chunk;
  });

  let beam = 0;
  try {
    const ready = Date.now();
    while (!output.includes("READY")) {
      if (host.exitCode !== null || host.signalCode !== null) {
        throw new Error(`host exited during boot (${host.exitCode ?? host.signalCode})\n${output}`);
      }
      if (Date.now() - ready > 90_000) {
        throw new Error(`timed out booting host\n${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    beam = Number(fs.readFileSync(path.join(dir, "state", "pid"), "utf8"));
    assert.equal(processAlive(beam), true);
    host.unref();
    await body({ host, beam });
  } finally {
    if (beam && processAlive(beam)) {
      try {
        process.kill(-beam, "SIGKILL");
      } catch {
        try {
          process.kill(beam, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    if (host.pid && processAlive(host.pid)) {
      try {
        process.kill(host.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the BEAM to stop");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
