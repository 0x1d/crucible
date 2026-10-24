import type { ToolExecuteResult } from "@grok/agent-sdk";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryRequest } from "./protocol.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeDir = path.join(repoRoot, "runtime");
const functionsDir = path.join(repoRoot, "functions");

export function runRegistryOp(
  request: RegistryRequest,
): ToolExecuteResult {
  const compile = spawnSync("mix", ["compile"], {
    cwd: runtimeDir,
    encoding: "utf-8",
    env: { ...process.env, MIX_ENV: "dev" },
  });

  if (compile.status !== 0) {
    return {
      ok: false,
      error: (compile.stderr || compile.stdout || "mix compile failed").trim(),
    };
  }

  const payload = JSON.stringify(request);

  const result = spawnSync(
    "mix",
    ["run", "--no-start", "-e", "Runtime.CLI.run_stdio()"],
    {
      cwd: runtimeDir,
      input: payload,
      encoding: "utf-8",
      env: {
        ...process.env,
        AGENT_FUNCTIONS_DIR: functionsDir,
        MIX_ENV: "dev",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    return {
      ok: false,
      error: stderr || `elixir runtime exited with code ${result.status}`,
    };
  }

  const stdout = (result.stdout || "").trim();
  try {
    return JSON.parse(stdout) as ToolExecuteResult;
  } catch {
    return {
      ok: false,
      error: `invalid JSON from runtime: ${stdout.slice(0, 500)}`,
    };
  }
}

/** @deprecated Use runRegistryOp */
export const runElixirOp = runRegistryOp;
