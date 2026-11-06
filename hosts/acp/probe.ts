import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import {
  discoverAgents,
  resolveSpawnSpec,
  type DiscoveredAgent,
  type RegistryAgent,
} from "./discovery.ts";
import { killAcpAgent, spawnAcpAgent } from "./spawn.ts";

export type ProbeSuccess = {
  status: "ok";
  protocolVersion: number;
  mcpOverAcp: boolean;
  agentName?: string;
};

export type ProbeFailure = {
  status: "failed";
  reason: string;
};

export type ProbeResult = ProbeSuccess | ProbeFailure;

export type ProbedAgent = DiscoveredAgent & { probe: ProbeResult };

const DEFAULT_PROBE_MS = 8_000;

export function mcpOverAcpSupported(
  capabilities: acp.InitializeResponse["agentCapabilities"],
): boolean {
  return capabilities?.mcpCapabilities?.acp === true;
}

function probeTimeoutMs(agent: RegistryAgent): number {
  return agent.probe?.timeoutMs ?? DEFAULT_PROBE_MS;
}

function minimalProbeClient() {
  return acp
    .client({ name: "alchemist-acp-probe" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      const option = params.options[0];
      if (!option) {
        return Promise.resolve({ outcome: { outcome: "cancelled" } });
      }
      return Promise.resolve({
        outcome: { outcome: "selected", optionId: option.optionId },
      });
    })
    .onRequest(acp.methods.client.fs.readTextFile, () =>
      Promise.resolve({ content: "" }),
    )
    .onRequest(acp.methods.client.fs.writeTextFile, () => Promise.resolve({}));
}

export async function probeSpawnedAgent(
  spawn: ReturnType<typeof resolveSpawnSpec>,
  timeoutMs: number,
): Promise<ProbeResult> {
  const { child, ended } = spawnAcpAgent(spawn);

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  const work = minimalProbeClient().connectWith(stream, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    return {
      protocolVersion: init.protocolVersion,
      mcpOverAcp: mcpOverAcpSupported(init.agentCapabilities),
      agentName: init.agentInfo?.name,
    };
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      work,
      ended.then((reason) => Promise.reject(reason)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`initialize timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return {
      status: "ok",
      protocolVersion: result.protocolVersion,
      mcpOverAcp: result.mcpOverAcp,
      agentName: result.agentName,
    };
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
    killAcpAgent(child);
  }
}

export async function probeAgent(
  agent: DiscoveredAgent,
  repoRoot: string,
  workspace: string,
): Promise<ProbeResult> {
  const spawn = resolveSpawnSpec(agent.spawn, repoRoot, workspace);
  return probeSpawnedAgent(spawn, probeTimeoutMs(agent));
}

export async function discoverAndProbeAgents(
  repoRoot: string,
  workspace = repoRoot,
  options?: { registryPath?: string; userPath?: string },
): Promise<ProbedAgent[]> {
  return Promise.all(
    discoverAgents(options).map(async (agent) => ({
      ...agent,
      probe: await probeAgent(agent, repoRoot, workspace),
    })),
  );
}

export function formatProbeDescription(probe: ProbeResult): string {
  if (probe.status === "ok") {
    const mcp = probe.mcpOverAcp ? " · MCP-over-ACP" : "";
    return `ok · protocol v${probe.protocolVersion}${mcp}`;
  }
  return `failed · ${probe.reason}`;
}
