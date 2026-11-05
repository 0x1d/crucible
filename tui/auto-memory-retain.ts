import type { MemoryExploreSettings } from "../hosts/cursor/bot/lib/host-flags.ts";

/** True when a completed assistant turn should queue `/remember`. */
export function shouldAutoRetain(
  completedTurns: number,
  settings: MemoryExploreSettings,
): boolean {
  const every = settings.memoryRetainEveryTurns;
  if (!settings.memoryAutoRetain || every < 1) return false;
  return completedTurns > 0 && completedTurns % every === 0;
}
