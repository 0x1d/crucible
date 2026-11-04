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
  handoffTool: true,
  handoffFork: true,
  toolResultLog: false,
};

export type SessionModelPicker = {
  id: string;
  effort?: string;
};

type HostConfigFile = HostFlags & {
  sessionModel?: SessionModelPicker;
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

function readConfigFile(stateRoot = defaultStateRoot()): HostConfigFile {
  const candidates = [configPath(stateRoot), legacyConfigPath(stateRoot)];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return mergeConfigFile(JSON.parse(readFileSync(file, "utf8")) as unknown);
    } catch {
      continue;
    }
  }
  return { ...DEFAULT_HOST_FLAGS };
}

function mergeConfigFile(raw: unknown): HostConfigFile {
  const base: HostConfigFile = { ...DEFAULT_HOST_FLAGS };
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  for (const id of HOST_FLAG_IDS) {
    const value = record[id];
    if (typeof value === "boolean") base[id] = value;
  }
  const sessionModel = record.sessionModel;
  if (sessionModel && typeof sessionModel === "object") {
    const id = (sessionModel as SessionModelPicker).id;
    const effort = (sessionModel as SessionModelPicker).effort;
    if (typeof id === "string" && id.length > 0) {
      base.sessionModel = typeof effort === "string" ? { id, effort } : { id };
    }
  }
  return base;
}

function writeConfigFile(stateRoot: string, config: HostConfigFile): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(configPath(stateRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function loadHostFlags(stateRoot = defaultStateRoot()): HostFlags {
  const { sessionModel: _ignored, ...flags } = readConfigFile(stateRoot);
  return flags;
}

export function loadSessionModel(stateRoot = defaultStateRoot()): SessionModelPicker | undefined {
  return readConfigFile(stateRoot).sessionModel;
}

export function saveSessionModel(
  picker: SessionModelPicker | undefined,
  stateRoot = defaultStateRoot(),
): void {
  const file = readConfigFile(stateRoot);
  if (picker?.id && picker.id !== "auto") file.sessionModel = picker;
  else delete file.sessionModel;
  writeConfigFile(stateRoot, file);
}

export function saveHostFlags(config: HostFlags, stateRoot = defaultStateRoot()): void {
  const file = readConfigFile(stateRoot);
  writeConfigFile(stateRoot, { ...file, ...config });
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
