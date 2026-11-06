import type { MemoryExploreSettings } from "./host-flags.ts";
import { runCodexTool } from "./codex-tool.ts";

export const MEMORY_RECALL_EXPLORE_LIMIT = 8;

const RECALL_OPEN = "[memory-recall]";
const RECALL_CLOSE = "[/memory-recall]";

/** User turn that should go straight to `fs.read` without host recall inject. */
export function isNamedPathReadTurn(message: string): boolean {
  const trimmed = message.trim();
  const match = /^read\s+(\S+)/i.exec(trimmed);
  if (!match) return false;
  const target = match[1];
  return (
    target.includes("/") ||
    target.includes("\\") ||
    target.startsWith("..") ||
    /^\//.test(target) ||
    /\.[a-z0-9]{1,8}$/i.test(target)
  );
}

type MemoryEntity = { id?: string; description?: string };

export function formatMemoryRecallAppend(entities: MemoryEntity[]): string {
  if (entities.length === 0) {
    return `${RECALL_OPEN}\n(no durable memory entities)\n${RECALL_CLOSE}`;
  }
  const lines = entities.map((row) => {
    const id = row.id ?? "?";
    const text = (row.description ?? "").trim();
    const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    return `- \`${id}\`: ${clipped || "(no description)"}`;
  });
  return `${RECALL_OPEN}\n${lines.join("\n")}\n${RECALL_CLOSE}`;
}

function parseExploreMemory(result: unknown): MemoryEntity[] {
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const payload =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : record;
  const entities = payload.entities;
  if (!Array.isArray(entities)) return [];
  return entities.filter((e) => e && typeof e === "object") as MemoryEntity[];
}

export async function fetchMemoryRecallEntities(
  limit = MEMORY_RECALL_EXPLORE_LIMIT,
): Promise<MemoryEntity[]> {
  const result = await runCodexTool({
    op: "call",
    name: "explore",
    args: { profile: "memory", limit },
  });
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: boolean }).ok === false
  ) {
    return [];
  }
  return parseExploreMemory(result);
}

export async function prependMemoryRecallBeforeExplore(
  message: string,
  settings: Pick<MemoryExploreSettings, "memoryRecallBeforeExplore">,
): Promise<string> {
  if (!settings.memoryRecallBeforeExplore) return message;
  if (isNamedPathReadTurn(message)) return message;

  try {
    const entities = await fetchMemoryRecallEntities();
    if (entities.length === 0) return message;
    const block = formatMemoryRecallAppend(entities);
    return `${message.trimEnd()}\n\n${block}`;
  } catch {
    return message;
  }
}
