/** Slugs that should go through `explore` when requireExploreBeforeProbe is on. */
const GATED_EXACT = new Set([
  "fs.list",
  "fs.glob",
  "fs.rg",
  "sys.cmd",
  "git.status",
  "git.diff",
  "git.log",
  "git.log_report",
  "http.get",
]);

const GATED_PREFIXES = ["fs.list", "fs.glob", "fs.rg", "git.", "http."];

export function isProbeSlug(name: string): boolean {
  if (GATED_EXACT.has(name)) return true;
  return GATED_PREFIXES.some((p) => name.startsWith(p) && name !== "fs.read");
}

export function isExploreGateBypass(name: string): boolean {
  if (name === "explore") return true;
  if (name.startsWith("memory.")) return true;
  return false;
}

const gates = new Map<string, boolean>();

export function resetExploreGate(workspaceDir: string): void {
  gates.set(workspaceDir, false);
}

export function markExploreGateSatisfied(workspaceDir: string): void {
  gates.set(workspaceDir, true);
}

export function isExploreGateSatisfied(workspaceDir: string): boolean {
  return gates.get(workspaceDir) === true;
}

export type ExploreGateBlock = {
  ok: false;
  isError: true;
  error: string;
};

export function exploreGateBlocked(
  name: string,
  workspaceDir: string,
  requireExplore: boolean,
): ExploreGateBlock | null {
  if (!requireExplore) return null;
  if (isExploreGateBypass(name)) {
    if (name === "explore") markExploreGateSatisfied(workspaceDir);
    return null;
  }
  if (name === "fs.read") {
    markExploreGateSatisfied(workspaceDir);
    return null;
  }
  if (!isProbeSlug(name)) return null;
  if (isExploreGateSatisfied(workspaceDir)) return null;
  return {
    ok: false,
    isError: true,
    error:
      "requireExploreBeforeProbe: call explore first (e.g. profile status, repo, or code) before raw probes like " +
      name,
  };
}
