import type { ToolExecuteResult } from "@grok/agent-sdk";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexRequest } from "./protocol.ts";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeDir = path.join(repoRoot, "runtime");
const functionsDir = path.join(repoRoot, "functions");

const bootTimeoutMs = 120_000;
const rpcTimeoutMs = 120_000;

type Vm = { pid: number; port: number };

let booting: Promise<Vm> | null = null;

/**
 * When true, the BEAM is spawned detached and unref'd so it outlives the Node
 * host (hosted deployments). When false, the VM is tied to the host process and
 * stopped on SIGINT/SIGTERM/exit (local dev, evals, CLI).
 *
 * Override with `ALCHEMIST_RUNTIME_DETACHED=1` or `=0`.
 */
export function runtimeDetached(): boolean {
  const override = process.env.ALCHEMIST_RUNTIME_DETACHED;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;
  return process.env.NODE_ENV === "production";
}

function registerAttachedLifecycle(): void {
  if (runtimeDetached()) return;
  if (process.env.ALCHEMIST_RUNTIME_NO_SHUTDOWN_HOOK === "1") return;

  const shutdown = () => {
    syncStopRuntime();
  };

  process.on("exit", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Synchronous stop for process exit handlers. */
export function syncStopRuntime(): void {
  booting = null;
  const vm = readVm();
  if (vm && alive(vm.pid)) {
    try {
      process.kill(vm.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  clearStateFiles();
}

function runtimeStamp(): string {
  const memory = process.env.AGENT_MEMORY_PATH ?? "";
  const functions = process.env.AGENT_FUNCTIONS_DIR ?? "";
  return `${sourceStamp()}\0${memory}\0${functions}`;
}

/**
 * Stop the recorded BEAM VM and clear port/pid files.
 * Use before changing `AGENT_MEMORY_PATH` or recovering from a graph lock.
 */
export async function stopRuntime(): Promise<void> {
  booting = null;
  await stopRecorded();
  clearStateFiles();
}

registerAttachedLifecycle();

function stateDir(): string {
  const configured = process.env.ALCHEMIST_STATE_DIR;
  return configured
    ? path.resolve(configured)
    : path.join(runtimeDir, ".alchemist");
}

/**
 * Send one codex op to Runtime.Server on the long-lived BEAM.
 * Mix compiles when sources change. The process that stays up is elixir.
 */
export async function runCodexOp(
  request: CodexRequest,
): Promise<ToolExecuteResult> {
  try {
    return await callOnce(request, false);
  } catch (error) {
    if (!isTransportError(error)) return failure(error);
    booting = null;
    try {
      return await callOnce(request, true);
    } catch (retryError) {
      return failure(retryError);
    }
  }
}

async function callOnce(
  request: CodexRequest,
  force: boolean,
): Promise<ToolExecuteResult> {
  const vm = await ensureVm(force);
  return rpc(vm.port, request);
}

function ensureVm(force: boolean): Promise<Vm> {
  if (!force && booting) {
    return booting.then((vm) => {
      if (alive(vm.pid) && readStamp() === runtimeStamp()) return vm;
      booting = null;
      return ensureVm(true);
    });
  }

  const next = boot(force).catch((error: unknown) => {
    if (booting === next) booting = null;
    throw error;
  });
  booting = next;
  return next;
}

async function boot(force: boolean): Promise<Vm> {
  const release = await acquireLock();
  let child: ChildProcess | undefined;
  try {
    if (!force) {
      const existing = healthyVm();
      if (existing) return existing;
    }

    await stopRecorded();
    clearStateFiles();
    ensureCompiled();
    child = await spawnVm();
    const vm = await waitForReady(child);
    fs.writeFileSync(path.join(stateDir(), "stamp"), runtimeStamp());
    if (runtimeDetached()) child.unref();
    return vm;
  } catch (error) {
    if (child?.pid && alive(child.pid)) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    throw error;
  } finally {
    release();
  }
}

function healthyVm(): Vm | null {
  const vm = readVm();
  if (!vm || !alive(vm.pid)) return null;
  if (readStamp() !== runtimeStamp()) return null;
  return vm;
}

function ensureCompiled(): void {
  const stamp = sourceStamp();
  const runtimeBeam = path.join(
    runtimeDir,
    "_build",
    "dev",
    "lib",
    "runtime",
    "ebin",
    "Elixir.Runtime.Server.beam",
  );
  if (readBuildStamp() === stamp && fs.existsSync(runtimeBeam)) return;

  const compile = spawnSync("mix", ["compile"], {
    cwd: runtimeDir,
    encoding: "utf8",
    env: { ...process.env, MIX_ENV: "dev" },
  });
  if (compile.status !== 0) {
    const detail = (compile.stderr || compile.stdout || "mix compile failed").trim();
    throw new Error(detail);
  }
  fs.mkdirSync(path.dirname(buildStampPath()), { recursive: true });
  fs.writeFileSync(buildStampPath(), stamp);
}

function ebinPaths(): string[] {
  const root = path.join(runtimeDir, "_build", "dev", "lib");
  if (!fs.existsSync(root)) {
    throw new Error("mix compile did not produce runtime/_build/dev/lib");
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "ebin"))
    .filter((dir) => fs.existsSync(dir));
}

function spawnVm(): Promise<ChildProcess> {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const logFd = fs.openSync(path.join(dir, "boot.log"), "w");
  const args = ["--no-halt"];
  for (const ebin of ebinPaths()) {
    args.push("-pa", ebin);
  }
  args.push("-e", "Application.ensure_all_started(:runtime, :permanent)");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_FUNCTIONS_DIR: functionsDir,
    ALCHEMIST_STATE_DIR: dir,
  };
  delete env.MIX_ENV;

  return new Promise((resolve, reject) => {
    const detached = runtimeDetached();
    const child = spawn("elixir", args, {
      cwd: runtimeDir,
      detached,
      stdio: ["ignore", "ignore", logFd],
      env,
    });
    fs.closeSync(logFd);
    child.once("error", (error) => {
      reject(error);
    });
    child.once("spawn", () => {
      resolve(child);
    });
  });
}

async function waitForReady(child: ChildProcess): Promise<Vm> {
  const started = Date.now();
  while (Date.now() - started < bootTimeoutMs) {
    const vm = readVm();
    if (vm && alive(vm.pid)) return vm;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw bootError(
        `elixir runtime exited during startup (${child.exitCode ?? child.signalCode})`,
      );
    }
    await sleep(50);
  }
  throw bootError("timed out starting elixir runtime");
}

function rpc(port: number, request: CodexRequest): Promise<ToolExecuteResult> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const body = Buffer.from(JSON.stringify(request), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);

    let buf = Buffer.alloc(0);
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(rpcTimeoutMs);
    socket.on("connect", () => {
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const expected = buf.readUInt32BE(0);
      if (expected > 10 * 1024 * 1024) {
        fail(new Error("runtime response exceeds 10MB"));
        return;
      }
      if (buf.length < 4 + expected) return;
      const json = buf.subarray(4, 4 + expected).toString("utf8");
      settled = true;
      socket.end();
      try {
        resolve(JSON.parse(json) as ToolExecuteResult);
      } catch {
        resolve({
          ok: false,
          error: `invalid JSON from runtime: ${json.slice(0, 500)}`,
        });
      }
    });
    socket.on("timeout", () => fail(new Error("runtime request timed out")));
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      if (!settled) fail(new Error("runtime closed the connection"));
    });
  });
}

async function acquireLock(): Promise<() => void> {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, "lock");
  const started = Date.now();

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      return () => {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // another starter already removed it
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 30_000) fs.unlinkSync(lockPath);
      } catch {
        // lock disappeared between stat and unlink
      }
      if (Date.now() - started > bootTimeoutMs) {
        throw new Error("timed out waiting for the elixir runtime lock");
      }
      await sleep(50);
    }
  }
}

async function stopRecorded(): Promise<void> {
  const vm = readVm();
  if (!vm) return;
  await stopPid(vm.pid);
}

async function stopPid(pid: number): Promise<void> {
  if (!alive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const started = Date.now();
  while (alive(pid) && Date.now() - started < 5_000) {
    await sleep(50);
  }
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function clearStateFiles(): void {
  for (const name of ["port", "pid", "stamp"]) {
    try {
      fs.unlinkSync(path.join(stateDir(), name));
    } catch {
      // not written yet
    }
  }
}

function readVm(): Vm | null {
  try {
    const port = Number(fs.readFileSync(path.join(stateDir(), "port"), "utf8").trim());
    const pid = Number(fs.readFileSync(path.join(stateDir(), "pid"), "utf8").trim());
    if (!Number.isInteger(port) || port <= 0) return null;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { port, pid };
  } catch {
    return null;
  }
}

function buildStampPath(): string {
  return path.join(runtimeDir, "_build", "dev", ".source-stamp");
}

function readBuildStamp(): string | null {
  try {
    return fs.readFileSync(buildStampPath(), "utf8").trim();
  } catch {
    return null;
  }
}

function readStamp(): string | null {
  try {
    return fs.readFileSync(path.join(stateDir(), "stamp"), "utf8").trim();
  } catch {
    return null;
  }
}

function sourceStamp(): string {
  const files: string[] = [];
  const add = (file: string) => {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.push(file);
  };
  add(path.join(runtimeDir, "mix.exs"));
  add(path.join(runtimeDir, "mix.lock"));
  collectEx(path.join(runtimeDir, "lib"), files);
  files.sort();

  const hash = crypto.createHash("sha1");
  for (const file of files) {
    const stat = fs.statSync(file);
    hash.update(path.relative(runtimeDir, file));
    hash.update(String(stat.mtimeMs));
    hash.update(String(stat.size));
  }
  return hash.digest("hex");
}

function collectEx(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectEx(full, out);
    else if (entry.name.endsWith(".ex")) out.push(full);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function bootError(message: string): Error {
  let detail = "";
  try {
    detail = fs.readFileSync(path.join(stateDir(), "boot.log"), "utf8").trim();
  } catch {
    // startup wrote nothing
  }
  const hint = bootHint(detail);
  const tail = detail.slice(-2000);
  const parts = [message];
  if (hint) parts.push(hint);
  if (tail) parts.push(tail);
  return new Error(parts.join("\n"));
}

function bootHint(log: string): string | null {
  if (/STG-026|Database is locked/.test(log)) {
    return (
      "MiniGraf memory is locked by another BEAM process. " +
      "Run: node scripts/runtime-doctor.mjs"
    );
  }
  if (/failed to start child: Runtime\.Memory/.test(log)) {
    return "Runtime.Memory failed to start. See boot.log above for the MiniGraf error.";
  }
  if (/Application runtime exited/.test(log)) {
    return "The :runtime OTP application failed to start. See boot.log above.";
  }
  return null;
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    /runtime closed the connection|runtime request timed out|elixir runtime exited/.test(
      error.message,
    )
  );
}

function failure(error: unknown): ToolExecuteResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
