#!/usr/bin/env node
/**
 * Run session_trace/factory-qna eval N times and append CSV rows.
 * Plain Node commands only (no nix wrappers). Run inside the existing nix shell.
 *
 *   node scripts/measure-session-trace-eval.mjs before 3
 *   node scripts/measure-session-trace-eval.mjs after 3
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(repoRoot, "hosts/cursor");
const csvPath = path.join(
  repoRoot,
  "docs/review/measure/session_trace-tools.csv",
);
const measureRoot = path.join(repoRoot, "docs/review/measure/runs");

const phase = process.argv[2];
const trials = Number(process.argv[3] ?? "3");
if (!phase || !Number.isFinite(trials) || trials < 1) {
  console.error("usage: measure-session-trace-eval.mjs <before|after> <trials>");
  process.exit(2);
}

fs.mkdirSync(path.dirname(csvPath), { recursive: true });
fs.mkdirSync(measureRoot, { recursive: true });

if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(
    csvPath,
    [
      "recorded_at",
      "phase",
      "trial",
      "eval_ok",
      "duration_ms",
      "call_function_total",
      "find_function_calls",
      "overview_calls",
      "query_calls",
      "remember_calls",
      "exploration_calls",
      "session_id",
    ].join(",") + "\n",
  );
}

const EXPLORATION = new Set([
  "fs.read",
  "fs.glob",
  "fs.list",
  "fs.tree",
  "sys.cmd",
  "text.slice",
  "text.grep",
]);

function summarizeToolCalls(toolCalls) {
  let callFunctionTotal = 0;
  let findFunctionCalls = 0;
  let overviewCalls = 0;
  let queryCalls = 0;
  let rememberCalls = 0;
  let explorationCalls = 0;
  for (const call of toolCalls ?? []) {
    if (call.toolName === "find_function") {
      findFunctionCalls += 1;
      continue;
    }
    if (call.toolName !== "call_function") continue;
    callFunctionTotal += 1;
    const name = call.args?.name ?? "";
    if (name === "memory.overview") overviewCalls += 1;
    if (name === "memory.query") queryCalls += 1;
    if (name === "memory.remember" || name === "memory.transact") {
      rememberCalls += 1;
    }
    if (EXPLORATION.has(name)) explorationCalls += 1;
  }
  return {
    callFunctionTotal,
    findFunctionCalls,
    overviewCalls,
    queryCalls,
    rememberCalls,
    explorationCalls,
  };
}

for (let trial = 1; trial <= trials; trial += 1) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const memoryPath = path.join(
    measureRoot,
    `${phase}-trial-${trial}-${stamp}.graph`,
  );

  const seedEnv = {
    ...process.env,
    AGENT_MEMORY_PATH: memoryPath,
  };

  spawnSync(process.execPath, [path.join(repoRoot, "scripts/runtime-doctor.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  // Case also seeds; pre-seed keeps a per-trial graph snapshot beside measure JSON.
  const seed = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(repoRoot, "scripts/seed-session-trace-memory.mjs"),
      memoryPath,
    ],
    { cwd: repoRoot, env: seedEnv, encoding: "utf8" },
  );
  if (seed.status !== 0) {
    console.error(seed.stderr || seed.stdout);
    process.exit(1);
  }

  const outPath = path.join(measureRoot, `${phase}-trial-${trial}-${stamp}.json`);
  const agentSdk = path.join(repoRoot, "node_modules/.bin/agent-sdk");
  const evalRun = spawnSync(
    agentSdk,
    [
      "eval",
      "session_trace/factory-qna",
      "--dir",
      agentDir,
      "--json",
      "--no-stream",
      "--out",
      outPath,
    ],
    {
      cwd: repoRoot,
      env: seedEnv,
      encoding: "utf8",
      timeout: 600_000,
    },
  );

  if (evalRun.status !== 0 && !fs.existsSync(outPath)) {
    console.error(evalRun.stderr || evalRun.stdout);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const result = payload.results?.[0];
  const stats = summarizeToolCalls(result?.toolCalls);
  const row = [
    new Date().toISOString(),
    phase,
    trial,
    payload.ok && result?.ok ? "true" : "false",
    result?.durationMs ?? "",
    stats.callFunctionTotal,
    stats.findFunctionCalls,
    stats.overviewCalls,
    stats.queryCalls,
    stats.rememberCalls,
    stats.explorationCalls,
    result?.sessionId ?? "",
  ].join(",");
  fs.appendFileSync(csvPath, row + "\n");
  process.stderr.write(`${phase} trial ${trial}: ${row}\n`);
}

process.stdout.write(`appended ${trials} rows to ${csvPath}\n`);
