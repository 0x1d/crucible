/**
 * Spec success criterion: an agent with `mcpCapabilities.acp` calls `call_function`
 * on a codex slug through MCP-over-ACP and receives capped JSON from the BEAM.
 * Needs Elixir on PATH: pnpm run eval:acp
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repoRoot } from "../../../core/elixir-bridge.ts";
import { AcpClientAdapter } from "../../../tui/adapters/acp.ts";
import type { HostEvent } from "../../../tui/adapters/types.ts";

test("call_function reaches the codex through MCP-over-ACP", { timeout: 180_000 }, async (t) => {
  const adapter = new AcpClientAdapter(
    {
      id: "fixture",
      label: "fixture",
      source: "registry",
      spawn: {
        command: process.execPath,
        args: [
          "--experimental-strip-types",
          "--no-warnings",
          path.join(repoRoot, "hosts/acp/mcp-over-acp-agent.ts"),
        ],
      },
    },
    { stateRoot: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acp-eval-")), ".agent-serve") },
  );
  t.after(() => adapter.close());

  const args = JSON.stringify({ name: "memory.overview", args: { limit: 1 } });
  const events: HostEvent[] = [];
  for await (const event of adapter.send(`call call_function ${args}`, new AbortController().signal)) {
    events.push(event);
  }
  const result = events.find((e) => e.type === "tool_result");
  assert.ok(result?.type === "tool_result");
  assert.equal(result.ok, true, result.output);

  const outcome = JSON.parse(result.output) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  assert.notEqual(outcome.result.isError, true, result.output);
  const payload = JSON.parse(outcome.result.content[0]?.text ?? "{}") as { ok?: boolean };
  assert.equal(payload.ok, true, result.output);
});
