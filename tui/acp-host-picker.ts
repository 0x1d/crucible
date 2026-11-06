import type { SelectItem } from "@earendil-works/pi-tui";
import {
  discoverAndProbeAgents,
  formatProbeDescription,
  type ProbedAgent,
} from "../hosts/acp/probe.ts";

export const SDK_HOST_PREFIX = "sdk:";
export const ACP_HOST_PREFIX = "acp:";

export function sdkHostValue(name: string): string {
  return `${SDK_HOST_PREFIX}${name}`;
}

export function acpHostValue(id: string): string {
  return `${ACP_HOST_PREFIX}${id}`;
}

export function parseHostPickerValue(value: string):
  | { kind: "sdk"; name: string }
  | { kind: "acp"; id: string }
  | undefined {
  if (value.startsWith(SDK_HOST_PREFIX)) {
    return { kind: "sdk", name: value.slice(SDK_HOST_PREFIX.length) };
  }
  if (value.startsWith(ACP_HOST_PREFIX)) {
    return { kind: "acp", id: value.slice(ACP_HOST_PREFIX.length) };
  }
  return undefined;
}

export function probedAgentSelectItems(agents: ProbedAgent[]): SelectItem[] {
  return agents.map((agent) => {
    const probeText = formatProbeDescription(agent.probe);
    return {
      value: acpHostValue(agent.id),
      label: agent.label,
      description: `ACP · ${probeText}${agent.source === "user" ? " · config" : ""}`,
    };
  });
}

/** Probes the configured agents. The picker lists them, and a selection needs the probe result. */
export async function loadAcpHosts(repoRoot: string, workspace: string): Promise<ProbedAgent[]> {
  return discoverAndProbeAgents(repoRoot, workspace);
}

/** Why an agent cannot be selected, or `undefined` when it can. */
export function unavailableReason(agent: ProbedAgent): string | undefined {
  return agent.probe.status === "failed" ? agent.probe.reason : undefined;
}
