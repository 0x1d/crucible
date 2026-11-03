import { PINNED_MODEL } from "../model.ts";
import { resolveHostFlags } from "./host-flags.ts";

const TUI_MODEL_ID_ENV = "ALCHEMIST_TUI_MODEL_ID";
const TUI_MODEL_EFFORT_ENV = "ALCHEMIST_TUI_MODEL_EFFORT";

function effortParam(model: string): string {
  return model.includes("gpt") ? "reasoning" : "reasoning_effort";
}

/** Same shape the TUI would send as modelConfig.model when dry-run were allowed. */
export function modelSettingFromPicker(id: string, effort: string) {
  if (id === PINNED_MODEL.id && effort === "high") {
    return PINNED_MODEL;
  }
  return {
    id,
    params: [
      { id: effortParam(id), value: effort },
      { id: "fast", value: "true" },
    ],
  };
}

export type SessionModelPicker = {
  id: string;
  effort?: string;
};

export function applySessionModelEnv(picker: SessionModelPicker | undefined): void {
  if (!picker?.id || picker.id === "auto") {
    delete process.env[TUI_MODEL_ID_ENV];
    delete process.env[TUI_MODEL_EFFORT_ENV];
    return;
  }
  process.env[TUI_MODEL_ID_ENV] = picker.id;
  process.env[TUI_MODEL_EFFORT_ENV] = picker.effort?.trim() || "high";
}

/** Model for defineAgent — read when the serve host loads agent.ts (before first turn). */
export function resolveAgentModel(): "auto" | typeof PINNED_MODEL | ReturnType<typeof modelSettingFromPicker> {
  const flags = resolveHostFlags();
  if (flags.pinnedModel) return PINNED_MODEL;
  const id = process.env[TUI_MODEL_ID_ENV]?.trim();
  if (!id || id === "auto") return "auto";
  const effort = process.env[TUI_MODEL_EFFORT_ENV]?.trim() || "high";
  return modelSettingFromPicker(id, effort);
}
