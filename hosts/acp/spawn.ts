import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { SpawnSpec } from "./discovery.ts";

export type AcpAgentProcess = ChildProcess & { stdin: Writable; stdout: Readable };

export type SpawnedAgent = {
  child: AcpAgentProcess;
  /** Resolves with the reason once the process cannot serve the connection any more. */
  ended: Promise<Error>;
};

/**
 * Starts an agent subprocess.
 *
 * The agent's stderr goes to `console.error`, which the TUI sends to its log file,
 * because an inherited stderr would write over the screen.
 */
export function spawnAcpAgent(spec: SpawnSpec): SpawnedAgent {
  const child = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }) as ChildProcess;
  const ended = new Promise<Error>((resolve) => {
    // Without an `error` listener, a missing binary would take down the whole host.
    child.on("error", (error) => resolve(new Error(`cannot start ${spec.command}: ${error.message}`)));
    child.on("exit", (code, signal) =>
      resolve(new Error(`${spec.command} exited (${signal ?? code})`)),
    );
  });
  child.stdin?.on("error", () => undefined);
  child.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[acp ${spec.command}] ${chunk.toString("utf8").trimEnd()}`);
  });
  return { child: child as AcpAgentProcess, ended };
}

export function killAcpAgent(child: ChildProcess): void {
  child.kill();
}
