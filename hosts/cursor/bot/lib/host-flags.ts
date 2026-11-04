import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Host that owns a `.agent-serve/host-flags.json` state root. */
export type HostId = "cursor" | "claude";

/**
 * Exclusive history-reclaim mechanism.
 * Only one may be active. SDK modes are host-specific:
 * - Cursor: `summarize` (agent.summarize / auto-summarize)
 * - Claude: `autocompact` (SDK autoCompactEnabled)
 * Both: `handoffFork` (alchemist handoff + TUI fork) or `off`.
 */
export type HistoryReclaimMode = "summarize" | "autocompact" | "handoffFork" | "off";

export const HISTORY_RECLAIM_MODES: HistoryReclaimMode[] = [
  "summarize",
  "autocompact",
  "handoffFork",
  "off",
];

/** Emit-time / observability flags (independent of reclaim mode). */
export type HostFlagId =
  | "resultDigest"
  | "defaultMaxBytes"
  | "pinnedModel"
  | "toolResultLog"
  | "handoffTool"
  | "handoffFork"
  | "autoSummarize"
  | "autoCompact";

export type HostFlags = {
  resultDigest: boolean;
  defaultMaxBytes: boolean;
  pinnedModel: boolean;
  toolResultLog: boolean;
  /** Exclusive reclaim control. Boolean reclaim flags below are derived from this. */
  historyReclaim: HistoryReclaimMode;
  /** Derived: true when historyReclaim === "handoffFork". */
  handoffTool: boolean;
  /** Derived: true when historyReclaim === "handoffFork". */
  handoffFork: boolean;
  /** Derived: true when historyReclaim === "summarize" (Cursor SDK). */
  autoSummarize: boolean;
  /** Derived: true when historyReclaim === "autocompact" (Claude SDK). */
  autoCompact: boolean;
};

/** Boolean flag ids accepted by `/flags on|off` (reclaim ids remap to historyReclaim). */
export const HOST_FLAG_IDS: HostFlagId[] = [
  "resultDigest",
  "defaultMaxBytes",
  "pinnedModel",
  "toolResultLog",
  "handoffTool",
  "handoffFork",
  "autoSummarize",
  "autoCompact",
];

const RECLAIM_FLAG_IDS = new Set<HostFlagId>([
  "handoffTool",
  "handoffFork",
  "autoSummarize",
  "autoCompact",
]);

const hostsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export function reclaimModesForHost(host: HostId): HistoryReclaimMode[] {
  if (host === "claude") return ["autocompact", "handoffFork", "off"];
  return ["summarize", "handoffFork", "off"];
}

export function deriveReclaimFlags(mode: HistoryReclaimMode): Pick<
  HostFlags,
  "handoffTool" | "handoffFork" | "autoSummarize" | "autoCompact"
> {
  return {
    handoffTool: mode === "handoffFork",
    handoffFork: mode === "handoffFork",
    autoSummarize: mode === "summarize",
    autoCompact: mode === "autocompact",
  };
}

export function historyReclaimFromBooleans(flags: {
  handoffTool?: boolean;
  handoffFork?: boolean;
  autoSummarize?: boolean;
  autoCompact?: boolean;
}): HistoryReclaimMode {
  if (flags.autoSummarize) return "summarize";
  if (flags.autoCompact) return "autocompact";
  if (flags.handoffFork || flags.handoffTool) return "handoffFork";
  return "off";
}

/** Map a stored/requested mode onto one allowed for the host. */
export function normalizeHistoryReclaim(
  mode: HistoryReclaimMode,
  host: HostId,
): HistoryReclaimMode {
  const allowed = reclaimModesForHost(host);
  if (allowed.includes(mode)) return mode;
  if (mode === "autocompact" && host === "cursor") return "summarize";
  if (mode === "summarize" && host === "claude") return "autocompact";
  return "off";
}

export function defaultHostFlags(host: HostId = "cursor"): HostFlags {
  const historyReclaim: HistoryReclaimMode = host === "claude" ? "autocompact" : "handoffFork";
  return {
    resultDigest: true,
    defaultMaxBytes: false,
    pinnedModel: false,
    toolResultLog: false,
    historyReclaim,
    ...deriveReclaimFlags(historyReclaim),
  };
}

/** Cursor defaults (handoffFork reclaim). Prefer `defaultHostFlags(host)` for Claude. */
export const DEFAULT_HOST_FLAGS: HostFlags = defaultHostFlags("cursor");

export type SessionModelPicker = {
  id: string;
  effort?: string;
};

type HostConfigFile = HostFlags & {
  sessionModel?: SessionModelPicker;
};

export function defaultStateRoot(host: HostId = "cursor"): string {
  return path.join(hostsRoot, host, ".agent-serve");
}

export function configPath(stateRoot = defaultStateRoot()): string {
  return path.join(stateRoot, "host-flags.json");
}

function isHistoryReclaimMode(value: unknown): value is HistoryReclaimMode {
  return typeof value === "string" && (HISTORY_RECLAIM_MODES as string[]).includes(value);
}

function withDerivedReclaim(base: HostFlags, mode: HistoryReclaimMode): HostFlags {
  return { ...base, historyReclaim: mode, ...deriveReclaimFlags(mode) };
}

function mergeConfigFile(raw: unknown, host: HostId = "cursor"): HostConfigFile {
  const base: HostConfigFile = { ...defaultHostFlags(host) };
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;

  for (const id of ["resultDigest", "defaultMaxBytes", "pinnedModel", "toolResultLog"] as const) {
    const value = record[id];
    if (typeof value === "boolean") base[id] = value;
  }

  if (isHistoryReclaimMode(record.historyReclaim)) {
    Object.assign(
      base,
      withDerivedReclaim(base, normalizeHistoryReclaim(record.historyReclaim, host)),
    );
  } else {
    const handoffTool = typeof record.handoffTool === "boolean" ? record.handoffTool : base.handoffTool;
    const handoffFork = typeof record.handoffFork === "boolean" ? record.handoffFork : base.handoffFork;
    const autoSummarize =
      typeof record.autoSummarize === "boolean" ? record.autoSummarize : false;
    const autoCompact = typeof record.autoCompact === "boolean" ? record.autoCompact : false;
    const derived = historyReclaimFromBooleans({
      handoffTool,
      handoffFork,
      autoSummarize,
      autoCompact,
    });
    Object.assign(base, withDerivedReclaim(base, normalizeHistoryReclaim(derived, host)));
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

function readConfigFile(stateRoot = defaultStateRoot(), host: HostId = "cursor"): HostConfigFile {
  const file = configPath(stateRoot);
  if (!existsSync(file)) return { ...defaultHostFlags(host) };
  try {
    return mergeConfigFile(JSON.parse(readFileSync(file, "utf8")) as unknown, host);
  } catch {
    return { ...defaultHostFlags(host) };
  }
}

function writeConfigFile(stateRoot: string, config: HostConfigFile): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(configPath(stateRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function loadHostFlags(stateRoot = defaultStateRoot(), host: HostId = "cursor"): HostFlags {
  const { sessionModel: _ignored, ...flags } = readConfigFile(stateRoot, host);
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
  const next = withDerivedReclaim(
    { ...file, ...config },
    config.historyReclaim ?? historyReclaimFromBooleans(config),
  );
  writeConfigFile(stateRoot, { ...file, ...next });
}

export function setHistoryReclaim(
  mode: HistoryReclaimMode,
  stateRoot = defaultStateRoot(),
  host: HostId = "cursor",
): HostFlags {
  const allowed = reclaimModesForHost(host);
  if (!allowed.includes(mode)) {
    throw new Error(
      `historyReclaim "${mode}" is not valid for ${host}. Use: ${allowed.join(" | ")}`,
    );
  }
  const file = readConfigFile(stateRoot, host);
  const next = withDerivedReclaim(file, mode);
  writeConfigFile(stateRoot, { ...file, ...next });
  return next;
}

export function isHostFlagEnabled(id: HostFlagId, stateRoot = defaultStateRoot()): boolean {
  return loadHostFlags(stateRoot)[id];
}

export function hostFlagEnvKey(id: HostFlagId | "historyReclaim"): string {
  return `ALCHEMIST_HOST_FLAG_${id.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

function readEnvFlag(id: HostFlagId): boolean | undefined {
  const raw = process.env[hostFlagEnvKey(id)];
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

function readEnvHistoryReclaim(): HistoryReclaimMode | undefined {
  const raw = process.env[hostFlagEnvKey("historyReclaim")];
  if (isHistoryReclaimMode(raw)) return raw;
  return undefined;
}

export function envFlagOverrides(host: HostId = "cursor"): Partial<HostFlags> {
  const out: Partial<HostFlags> = {};
  for (const id of ["resultDigest", "defaultMaxBytes", "pinnedModel", "toolResultLog"] as const) {
    const value = readEnvFlag(id);
    if (value !== undefined) out[id] = value;
  }
  const mode = readEnvHistoryReclaim();
  if (mode) {
    const normalized = normalizeHistoryReclaim(mode, host);
    out.historyReclaim = normalized;
    Object.assign(out, deriveReclaimFlags(normalized));
    return out;
  }
  const autoSummarize = readEnvFlag("autoSummarize");
  const autoCompact = readEnvFlag("autoCompact");
  const handoffTool = readEnvFlag("handoffTool");
  const handoffFork = readEnvFlag("handoffFork");
  if (
    autoSummarize !== undefined ||
    autoCompact !== undefined ||
    handoffTool !== undefined ||
    handoffFork !== undefined
  ) {
    const derived = historyReclaimFromBooleans({
      autoSummarize: autoSummarize ?? false,
      autoCompact: autoCompact ?? false,
      handoffTool: handoffTool ?? false,
      handoffFork: handoffFork ?? false,
    });
    const normalized = normalizeHistoryReclaim(derived, host);
    out.historyReclaim = normalized;
    Object.assign(out, deriveReclaimFlags(normalized));
  }
  return out;
}

export function resolveHostFlags(
  stateRoot = defaultStateRoot(),
  host: HostId = "cursor",
): HostFlags {
  const loaded = loadHostFlags(stateRoot, host);
  const env = envFlagOverrides(host);
  if (env.historyReclaim) {
    return withDerivedReclaim({ ...loaded, ...env }, env.historyReclaim);
  }
  return { ...loaded, ...env };
}

export function isReclaimFlagId(id: string): id is HostFlagId {
  return RECLAIM_FLAG_IDS.has(id as HostFlagId);
}

/** Parse `/flags reclaim` tokens, including host-facing aliases. */
export function parseReclaimModeToken(
  token: string,
  host: HostId,
): HistoryReclaimMode | undefined {
  const raw = token.trim();
  if (!raw) return undefined;
  const aliases: Record<string, HistoryReclaimMode> = {
    summarize: "summarize",
    autoSummarize: "summarize",
    autosummarize: "summarize",
    autocompact: "autocompact",
    autoCompact: "autocompact",
    compact: "autocompact",
    handoffFork: "handoffFork",
    handoff: "handoffFork",
    off: "off",
  };
  const mode = aliases[raw] ?? (isHistoryReclaimMode(raw) ? raw : undefined);
  if (!mode) return undefined;
  if (!reclaimModesForHost(host).includes(mode)) return undefined;
  return mode;
}

export const DEFAULT_READ_HTTP_MAX_BYTES = 65_536;
