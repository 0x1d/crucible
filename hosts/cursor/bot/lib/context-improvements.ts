import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Toggle ids for context-window experiments. */
export type ContextImprovementId =
  | "resultDigest"
  | "defaultMaxBytes"
  | "pinnedModel"
  | "handoffTool"
  | "handoffFork"
  | "toolResultLog";

export type ContextImprovementsConfig = Record<ContextImprovementId, boolean>;

export const CONTEXT_IMPROVEMENT_IDS: ContextImprovementId[] = [
  "resultDigest",
  "defaultMaxBytes",
  "pinnedModel",
  "handoffTool",
  "handoffFork",
  "toolResultLog",
];

/** Production defaults: proven digest on; experiments off. */
export const DEFAULT_CONTEXT_IMPROVEMENTS: ContextImprovementsConfig = {
  resultDigest: true,
  defaultMaxBytes: false,
  pinnedModel: false,
  handoffTool: false,
  handoffFork: false,
  toolResultLog: false,
};

const hostDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function defaultStateRoot(): string {
  return path.join(hostDir, ".agent-serve");
}

export function configPath(stateRoot = defaultStateRoot()): string {
  return path.join(stateRoot, "context-improvements.json");
}

function mergeConfig(raw: unknown): ContextImprovementsConfig {
  const base = { ...DEFAULT_CONTEXT_IMPROVEMENTS };
  if (!raw || typeof raw !== "object") return base;
  for (const id of CONTEXT_IMPROVEMENT_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === "boolean") base[id] = value;
  }
  return base;
}

export function loadContextImprovements(stateRoot = defaultStateRoot()): ContextImprovementsConfig {
  const file = configPath(stateRoot);
  if (!existsSync(file)) return { ...DEFAULT_CONTEXT_IMPROVEMENTS };
  try {
    return mergeConfig(JSON.parse(readFileSync(file, "utf8")) as unknown);
  } catch {
    return { ...DEFAULT_CONTEXT_IMPROVEMENTS };
  }
}

export function saveContextImprovements(
  config: ContextImprovementsConfig,
  stateRoot = defaultStateRoot(),
): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(configPath(stateRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function isImprovementEnabled(
  id: ContextImprovementId,
  stateRoot = defaultStateRoot(),
): boolean {
  return loadContextImprovements(stateRoot)[id];
}

/** Env key for serve / eval: `ALCHEMIST_CTX_RESULT_DIGEST`, `ALCHEMIST_CTX_HANDOFF_TOOL`, … */
export function envKeyForImprovement(id: ContextImprovementId): string {
  return `ALCHEMIST_CTX_${id.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

/** Env override for the serve child: ALCHEMIST_CTX_<ID>=1|0 */
export function envOverrides(): Partial<ContextImprovementsConfig> {
  const out: Partial<ContextImprovementsConfig> = {};
  for (const id of CONTEXT_IMPROVEMENT_IDS) {
    const key = envKeyForImprovement(id);
    const raw = process.env[key];
    if (raw === "1" || raw === "true") out[id] = true;
    if (raw === "0" || raw === "false") out[id] = false;
  }
  return out;
}

export function effectiveContextImprovements(stateRoot = defaultStateRoot()): ContextImprovementsConfig {
  return { ...loadContextImprovements(stateRoot), ...envOverrides() };
}

export const DEFAULT_READ_HTTP_MAX_BYTES = 65_536;
