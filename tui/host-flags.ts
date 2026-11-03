import {
  type HostFlagId,
  type HostFlags,
  HOST_FLAG_IDS,
  DEFAULT_HOST_FLAGS,
  loadHostFlags,
  saveHostFlags,
  defaultStateRoot,
} from "../hosts/cursor/bot/lib/host-flags.ts";

export {
  type HostFlagId,
  type HostFlags,
  HOST_FLAG_IDS,
  DEFAULT_HOST_FLAGS,
  loadHostFlags,
  saveHostFlags,
  defaultStateRoot,
};

export function formatHostFlags(config: HostFlags): string {
  return HOST_FLAG_IDS.map((id) => `${id}: ${config[id] ? "on" : "off"}`).join("\n");
}

export function parseHostFlagsCommand(arg: string): { action: string; rest: string } {
  const trimmed = arg.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return { action: trimmed, rest: "" };
  return { action: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() };
}

export function applyHostFlagsCommand(
  arg: string,
  stateRoot = defaultStateRoot(),
): { message: string; config: HostFlags } {
  const config = loadHostFlags(stateRoot);
  const { action, rest } = parseHostFlagsCommand(arg);
  if (!action || action === "list" || action === "show") {
    return { message: formatHostFlags(config), config };
  }
  if (action === "reset") {
    saveHostFlags(DEFAULT_HOST_FLAGS, stateRoot);
    return {
      message: "Reset host flags to defaults. Restart the TUI for serve-side flags.",
      config: { ...DEFAULT_HOST_FLAGS },
    };
  }
  if (action === "on" || action === "off") {
    const id = rest as HostFlagId;
    if (!HOST_FLAG_IDS.includes(id)) {
      return { message: `Unknown flag "${rest}".`, config };
    }
    config[id] = action === "on";
    saveHostFlags(config, stateRoot);
    return {
      message: `${id} is now ${action}. Serve-side flags apply after restart.`,
      config,
    };
  }
  return {
    message: "Usage: /flags list | /flags on <id> | /flags off <id> | /flags reset",
    config,
  };
}
