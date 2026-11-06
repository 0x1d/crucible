#!/usr/bin/env node
/**
 * Phase 0: stdio ACP client spike — spawn hosts/acp/agent.ts and run one prompt.
 *
 * Usage: node --experimental-strip-types hosts/acp/spike-client.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { repoRoot } from "../../core/elixir-bridge.ts";

const hostDir = dirname(fileURLToPath(import.meta.url));

function spawnAgent(): ChildProcess {
  const agentPath = join(hostDir, "agent.ts");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawn(npx, ["tsx", agentPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
}

async function main(): Promise<number> {
  const agentProcess = spawnAgent();
  if (!agentProcess.stdin || !agentProcess.stdout) {
    console.error("Failed to spawn ACP agent subprocess");
    return 1;
  }

  const stream = acp.ndJsonStream(
    Writable.toWeb(agentProcess.stdin),
    Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>,
  );

  const clientApp = acp
    .client({ name: "alchemist-acp-spike" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      const allow = params.options.find((o) => o.kind === "allow_once") ?? params.options[0];
      console.error(`[spike] permission: ${params.toolCall.title} → ${allow?.name ?? "none"}`);
      if (!allow) {
        return Promise.resolve({ outcome: { outcome: "cancelled" } });
      }
      return Promise.resolve({
        outcome: { outcome: "selected", optionId: allow.optionId },
      });
    })
    .onRequest(acp.methods.client.fs.readTextFile, ({ params }) => {
      console.error(`[spike] readTextFile ${params.path}`);
      return Promise.resolve({ content: "(spike mock content)" });
    })
    .onRequest(acp.methods.client.fs.writeTextFile, ({ params }) => {
      console.error(`[spike] writeTextFile ${params.path}`);
      return Promise.resolve({});
    });

  try {
    const result = await clientApp.connectWith(stream, async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });
      console.log(`Connected (protocol v${init.protocolVersion})`);

      return ctx.buildSession(repoRoot).withSession(async (session) => {
        console.log(`Session ${session.sessionId}`);
        session.prompt("Hello, ACP spike agent!");

        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === "stop") {
            return message.response;
          }
          const update = message.update;
          switch (update.sessionUpdate) {
            case "agent_message_chunk":
              if (update.content.type === "text") {
                process.stdout.write(update.content.text);
              }
              break;
            case "tool_call":
              console.error(`\n[tool] ${update.title} (${update.status})`);
              break;
            case "tool_call_update":
              console.error(`[tool update] ${update.toolCallId} → ${update.status}`);
              break;
            default:
              break;
          }
        }
      });
    });

    console.log(`\nStop reason: ${result.stopReason}`);
    return 0;
  } catch (err) {
    console.error("Spike failed:", err);
    return 1;
  } finally {
    agentProcess.kill();
  }
}

process.exit(await main());
