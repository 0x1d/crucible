import {
  type ContextImprovementId,
  type ContextImprovementsConfig,
  CONTEXT_IMPROVEMENT_IDS,
  DEFAULT_CONTEXT_IMPROVEMENTS,
  loadContextImprovements,
  saveContextImprovements,
  defaultStateRoot,
} from "../hosts/cursor/bot/lib/context-improvements.ts";

export {
  type ContextImprovementId,
  type ContextImprovementsConfig,
  CONTEXT_IMPROVEMENT_IDS,
  DEFAULT_CONTEXT_IMPROVEMENTS,
  loadContextImprovements,
  saveContextImprovements,
  defaultStateRoot,
};

export function formatContextImprovements(config: ContextImprovementsConfig): string {
  return CONTEXT_IMPROVEMENT_IDS.map((id) => `${id}: ${config[id] ? "on" : "off"}`).join("\n");
}

export function parseContextCommand(arg: string): { action: string; rest: string } {
  const trimmed = arg.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return { action: trimmed, rest: "" };
  return { action: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() };
}

export function applyContextCommand(
  arg: string,
  stateRoot = defaultStateRoot(),
): { message: string; config: ContextImprovementsConfig } {
  const config = loadContextImprovements(stateRoot);
  const { action, rest } = parseContextCommand(arg);
  if (!action || action === "list" || action === "show") {
    return { message: formatContextImprovements(config), config };
  }
  if (action === "reset") {
    saveContextImprovements(DEFAULT_CONTEXT_IMPROVEMENTS, stateRoot);
    return {
      message: "Reset context improvements to defaults. Restart the TUI for host flags.",
      config: { ...DEFAULT_CONTEXT_IMPROVEMENTS },
    };
  }
  if (action === "on" || action === "off") {
    const id = rest as ContextImprovementId;
    if (!CONTEXT_IMPROVEMENT_IDS.includes(id)) {
      return { message: `Unknown improvement "${rest}".`, config };
    }
    config[id] = action === "on";
    saveContextImprovements(config, stateRoot);
    return {
      message: `${id} is now ${action}. Host-side flags apply after restart.`,
      config,
    };
  }
  return {
    message: "Usage: /ctx list | /ctx on <id> | /ctx off <id> | /ctx reset",
    config,
  };
}
