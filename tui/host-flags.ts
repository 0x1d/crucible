import {
  type HostFlagId,
  type HostFlags,
  type HostId,
  type HistoryReclaimMode,
  HOST_FLAG_IDS,
  DEFAULT_HOST_FLAGS,
  defaultHostFlags,
  defaultStateRoot,
  loadHostFlags,
  loadMaxContextTokens,
  saveHostFlags,
  saveMaxContextTokens,
  parseTokenCount,
  DEFAULT_MAX_CONTEXT_TOKENS,
  setHistoryReclaim,
  isReclaimFlagId,
  reclaimModesForHost,
  parseReclaimModeToken,
} from "../hosts/cursor/bot/lib/host-flags.ts";

export {
  type HostFlagId,
  type HostFlags,
  type HostId,
  type HistoryReclaimMode,
  HOST_FLAG_IDS,
  DEFAULT_HOST_FLAGS,
  defaultHostFlags,
  defaultStateRoot,
  loadHostFlags,
  saveHostFlags,
};

function asHostId(host: string | undefined): HostId {
  return host === "claude" ? "claude" : "cursor";
}

function reclaimFlagLabel(id: HostFlagId, host: HostId): boolean {
  if (id === "autoSummarize") return host === "cursor";
  if (id === "autoCompact") return host === "claude";
  return true;
}

export function formatHostFlags(
  config: HostFlags,
  host: HostId = "cursor",
  root: string = defaultStateRoot(host),
): string {
  const modes = reclaimModesForHost(host).join(" | ");
  const lines = [
    `maxContextTokens: ${loadMaxContextTokens(root, host)}`,
    `historyReclaim: ${config.historyReclaim} (allowed: ${modes})`,
    ...HOST_FLAG_IDS.filter((id) => !isReclaimFlagId(id)).map(
      (id) => `${id}: ${config[id] ? "on" : "off"}`,
    ),
    `handoffTool: ${config.handoffTool ? "on" : "off"} (from historyReclaim)`,
    `handoffFork: ${config.handoffFork ? "on" : "off"} (from historyReclaim)`,
  ];
  if (host === "cursor") {
    lines.push(`autoSummarize: ${config.autoSummarize ? "on" : "off"} (from historyReclaim)`);
  } else {
    lines.push(`autoCompact: ${config.autoCompact ? "on" : "off"} (from historyReclaim)`);
  }
  return lines.join("\n");
}

export function parseHostFlagsCommand(arg: string): { action: string; rest: string } {
  const trimmed = arg.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return { action: trimmed, rest: "" };
  return { action: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() };
}

function reclaimModeFromFlag(id: HostFlagId, enable: boolean, host: HostId): HistoryReclaimMode | undefined {
  if (!enable) return "off";
  if (id === "autoSummarize") return host === "cursor" ? "summarize" : undefined;
  if (id === "autoCompact") return host === "claude" ? "autocompact" : undefined;
  if (id === "handoffTool" || id === "handoffFork") return "handoffFork";
  return undefined;
}

export function applyHostFlagsCommand(
  arg: string,
  stateRoot?: string,
  host: string | undefined = "cursor",
): { message: string; config: HostFlags } {
  const hostId = asHostId(host);
  const root = stateRoot ?? defaultStateRoot(hostId);
  const config = loadHostFlags(root, hostId);
  const { action, rest } = parseHostFlagsCommand(arg);
  const allowed = reclaimModesForHost(hostId).join(" | ");

  if (!action || action === "list" || action === "show") {
    return { message: formatHostFlags(config, hostId, root), config };
  }

  if (action === "reset") {
    const defaults = defaultHostFlags(hostId);
    saveHostFlags(defaults, root);
    return {
      message: `Reset ${hostId} host flags to defaults (historyReclaim=${defaults.historyReclaim}). Restart for serve-side flags.`,
      config: { ...defaults },
    };
  }

  if (action === "context") {
    if (!rest) {
      return {
        message: `maxContextTokens: ${loadMaxContextTokens(root, hostId)} (default ${DEFAULT_MAX_CONTEXT_TOKENS})`,
        config,
      };
    }
    if (rest === "reset" || rest === "default") {
      saveMaxContextTokens(undefined, root, hostId);
      return { message: `maxContextTokens reset to ${DEFAULT_MAX_CONTEXT_TOKENS}.`, config };
    }
    const tokens = parseTokenCount(rest);
    if (!tokens) {
      return { message: `Invalid token count "${rest}". Use e.g. 256k or 256000.`, config };
    }
    saveMaxContextTokens(tokens, root, hostId);
    return {
      message: `maxContextTokens is now ${tokens} for ${hostId}. Restart for serve-side flags.`,
      config,
    };
  }

  if (action === "reclaim") {
    const mode = parseReclaimModeToken(rest, hostId);
    if (!mode) {
      return {
        message: `Unknown or host-invalid reclaim mode "${rest}". Use: ${allowed}`,
        config,
      };
    }
    const next = setHistoryReclaim(mode, root, hostId);
    return {
      message: `historyReclaim is now ${mode}. Only one reclaim mechanism is active. Restart for serve-side flags.`,
      config: next,
    };
  }

  if (action === "on" || action === "off") {
    const id = rest as HostFlagId;
    if (!HOST_FLAG_IDS.includes(id)) {
      return { message: `Unknown flag "${rest}".`, config };
    }
    if (isReclaimFlagId(id)) {
      if (!reclaimFlagLabel(id, hostId)) {
        const hint =
          id === "autoCompact"
            ? "autoCompact is Claude-only; on Cursor use autoSummarize / reclaim summarize"
            : "autoSummarize is Cursor-only; on Claude use autoCompact / reclaim autocompact";
        return { message: hint, config };
      }
      const mode = reclaimModeFromFlag(id, action === "on", hostId);
      if (!mode) {
        return { message: `Cannot map ${id} for ${hostId}.`, config };
      }
      const next = setHistoryReclaim(mode, root, hostId);
      return {
        message: `${id} ${action} → historyReclaim=${mode} (exclusive). Restart for serve-side flags.`,
        config: next,
      };
    }
    const emitId = id as "resultDigest" | "defaultMaxBytes" | "pinnedModel" | "toolResultLog";
    config[emitId] = action === "on";
    saveHostFlags(config, root);
    return {
      message: `${id} is now ${action}. Serve-side flags apply after restart.`,
      config,
    };
  }

  return {
    message: `Usage: /flags list | /flags context [tokens|reset] | /flags reclaim <${allowed}> | /flags on <id> | /flags off <id> | /flags reset`,
    config,
  };
}
