import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const acpDir = path.dirname(fileURLToPath(import.meta.url));

export type SpawnSpec = {
  command: string;
  args?: string[];
  cwd?: string;
};

export type RegistryAgent = {
  id: string;
  label: string;
  spawn: SpawnSpec;
  probe?: { timeoutMs?: number };
};

export type UserAgentsFile = {
  agents?: Record<
    string,
    {
      command: string;
      args?: string[];
      cwd?: string;
    }
  >;
};

export type DiscoveredAgent = RegistryAgent & { source: "registry" | "user" };

function defaultRegistryPath(): string {
  return path.join(acpDir, "registry.json");
}

export function defaultUserAgentsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "alchemist", "acp-agents.json");
}

export function substituteWorkspace(template: string, workspace: string): string {
  return template.replaceAll("${workspace}", workspace);
}

export function resolveSpawnSpec(
  spawn: SpawnSpec,
  repoRoot: string,
  workspace: string,
): SpawnSpec {
  const cwdTemplate = spawn.cwd ?? repoRoot;
  const cwd = path.isAbsolute(cwdTemplate)
    ? cwdTemplate
    : substituteWorkspace(cwdTemplate, workspace);
  const args = (spawn.args ?? []).map((arg) => substituteWorkspace(arg, workspace));
  return { command: spawn.command, args, cwd };
}

export function loadRegistry(registryPath = defaultRegistryPath()): RegistryAgent[] {
  const raw = fs.readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw) as { agents?: RegistryAgent[] };
  return parsed.agents ?? [];
}

export function loadUserAgents(userPath = defaultUserAgentsPath()): RegistryAgent[] {
  if (!fs.existsSync(userPath)) return [];
  const raw = fs.readFileSync(userPath, "utf8");
  const parsed = JSON.parse(raw) as UserAgentsFile;
  const entries = parsed.agents ?? {};
  return Object.entries(entries).map(([label, spec]) => ({
    id: slugFromLabel(label),
    label,
    spawn: {
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
    },
  }));
}

function slugFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Registry entries first; user config overrides matching ids. */
export function mergeAgentLists(
  registry: RegistryAgent[],
  user: RegistryAgent[],
): DiscoveredAgent[] {
  const byId = new Map<string, DiscoveredAgent>();
  for (const agent of registry) {
    byId.set(agent.id, { ...agent, source: "registry" });
  }
  for (const agent of user) {
    byId.set(agent.id, { ...agent, source: "user" });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function discoverAgents(options?: {
  registryPath?: string;
  userPath?: string;
}): DiscoveredAgent[] {
  const registry = loadRegistry(options?.registryPath);
  const user = loadUserAgents(options?.userPath);
  return mergeAgentLists(registry, user);
}
