#!/usr/bin/env node
import { repoRoot } from "../../core/elixir-bridge.ts";
import { discoverAndProbeAgents, formatProbeDescription } from "./probe.ts";

const probed = await discoverAndProbeAgents(repoRoot, repoRoot);
for (const agent of probed) {
  console.log(`${agent.id}\t${agent.label}\t${formatProbeDescription(agent.probe)}`);
}
