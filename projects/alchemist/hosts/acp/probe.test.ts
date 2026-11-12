import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatProbeDescription, probeSpawnedAgent } from "./probe.ts";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-over-acp-agent.ts");

test("formatProbeDescription ok includes protocol and MCP-over-ACP", () => {
  assert.equal(
    formatProbeDescription({
      status: "ok",
      protocolVersion: 1,
      mcpOverAcp: true,
    }),
    "ok · protocol v1 · MCP-over-ACP",
  );
});

test("formatProbeDescription failed includes reason", () => {
  assert.match(
    formatProbeDescription({ status: "failed", reason: "timed out" }),
    /failed · timed out/,
  );
});

test("probeSpawnedAgent reads MCP-over-ACP from initialize", async () => {
  const result = await probeSpawnedAgent(
    { command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", fixture] },
    8_000,
  );
  assert.deepEqual(result, {
    status: "ok",
    protocolVersion: 1,
    mcpOverAcp: true,
    agentName: "fixture",
  });
});

test("probeSpawnedAgent reports a missing binary as a failure", async () => {
  const result = await probeSpawnedAgent({ command: "alchemist-no-such-agent" }, 8_000);
  assert.equal(result.status, "failed");
  assert.match((result as { reason: string }).reason, /cannot start alchemist-no-such-agent/);
});
