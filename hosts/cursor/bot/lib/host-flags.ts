import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HostFlagId =
  | "resultDigest"
  | "defaultMaxBytes"
  | "pinnedModel"
  | "handoffTool"
  | "handoffFork"
  | "toolResultLog";

export type HostFlags = Record<HostFlagId, boolean>;

export const HOST_FLAG_IDS: HostFlagId[] = [
  "resultDigest",
  "defaultMaxBytes",
  "pinnedModel",
  "handoffTool",
  "handoffFork",
  "toolResultLog",
];

export const DEFAULT_HOST_FLAGS: HostFlags = {
  resultDigest: true,
  defaultMaxBytes: false,
  pinnedModel: false,
  handoffTool: false,
  handoffFork: false,
  toolResultLog: false,
};

const hostDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const LEGACY_CONFIG_BASENAME = "context-improvements.json";

export function defaultStateRoot(): string {
  return path.join(hostDir, ".agent-serve");
}

export function configPath(stateRoot = defaultStateRoot()): string {
  return path.join(stateRoot, "host-flags.json");
}

function legacyConfigPath(stateRoot = defaultStateRoot()): string {
  return path.join(stateRoot, LEGACY_CONFIG_BASENAME);
}

function mergeConfig(raw: unknown): HostFlags {
  const base = { ...DEFAULT_HOST_FLAGS };
  if (!raw || typeof raw !== "object") return base;
  for (const id of HOST_FLAG_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === "boolean") base[id] = value;
  }
  return base;
}

export function loadHostFlags(stateRoot = defaultStateRoot()): HostFlags {
  const candidates = [configPath(stateRoot), legacyConfigPath(stateRoot)];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return mergeConfig(JSON.parse(readFileSync(file, "utf8")) as unknown);
    } catch {
      continue;
    }
  }
  return { ...DEFAULT_HOST_FLAGS };
}

export function saveHostFlags(config: HostFlags, stateRoot = defaultStateRoot()): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(configPath(stateRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function isHostFlagEnabled(id: HostFlagId, stateRoot = defaultStateRoot()): boolean {
  return loadHostFlags(stateRoot)[id];
}

export function hostFlagEnvKey(id: HostFlagId): string {
  return `ALCHEMIST_HOST_FLAG_${id.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

function legacyHostFlagEnvKey(id: HostFlagId): string {
  return `ALCHEMIST_CTX_${id.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

function readEnvFlag(id: HostFlagId): boolean | undefined {
  for (const key of [hostFlagEnvKey(id), legacyHostFlagEnvKey(id)]) {
    const raw = process.env[key];
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  }
  return undefined;
}

export function envFlagOverrides(): Partial<HostFlags> {
  const out: Partial<HostFlags> = {};
  for (const id of HOST_FLAG_IDS) {
    const value = readEnvFlag(id);
    if (value !== undefined) out[id] = value;
  }
  return out;
}

export function resolveHostFlags(stateRoot = defaultStateRoot()): HostFlags {
  return { ...loadHostFlags(stateRoot), ...envFlagOverrides() };
}

export const DEFAULT_READ_HTTP_MAX_BYTES = 65_536;
