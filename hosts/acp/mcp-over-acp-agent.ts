#!/usr/bin/env node
/**
 * Scripted ACP agent for tests and evals. It declares MCP-over-ACP and session loading.
 * The prompt is one command, which lets a test drive each client-side method:
 *
 *   tools | call <tool> <json> | read <path> | write <path> <text> | ask | echo <text> | hang | die | hello
 */
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";

type Session = { history: string[]; serverId?: string; cancel?: () => void };

const sessions = new Map<string, Session>();
const mcp = new acp.McpOverAcpCaller({ clientInfo: { name: "alchemist-fixture", version: "1.0.0" } });

function acpServerId(servers: acp.McpServer[]): string | undefined {
  return servers.find(acp.isMcpServerAcp)?.serverId;
}

function sessionOf(sessionId: string): Session {
  const session = sessions.get(sessionId);
  if (!session) throw acp.RequestError.sessionNotFound(sessionId);
  return session;
}

const say = (cx: acp.AgentContext, sessionId: string, text: string) =>
  cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  });

async function runCommand(
  cx: acp.AgentContext,
  sessionId: string,
  session: Session,
  command: string,
): Promise<string> {
  const [verb = "", first = "", ...rest] = command.split(" ");
  switch (verb) {
    case "tools":
    case "call": {
      if (!session.serverId) return "no acp server";
      const outcome =
        verb === "tools"
          ? await mcp.request(cx, session.serverId, "tools/list", {})
          : await mcp.request(cx, session.serverId, "tools/call", {
              name: first,
              arguments: JSON.parse(rest.join(" ") || "{}"),
            });
      return JSON.stringify(outcome);
    }
    case "read":
      return (await cx.request(acp.methods.client.fs.readTextFile, { sessionId, path: first })).content;
    case "write":
      await cx.request(acp.methods.client.fs.writeTextFile, {
        sessionId,
        path: first,
        content: rest.join(" "),
      });
      return "written";
    case "echo":
      return [first, ...rest].join(" ");
    case "ask": {
      const answer = await cx.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "ask_1", title: "Delete everything" },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      });
      return answer.outcome.outcome === "selected" ? answer.outcome.optionId : "cancelled";
    }
    default:
      return `hello from ${verb}`;
  }
}

async function prompt(params: acp.PromptRequest, cx: acp.AgentContext): Promise<acp.PromptResponse> {
  const { sessionId } = params;
  const session = sessionOf(sessionId);
  const first = params.prompt[0];
  const command = first?.type === "text" ? first.text : "";
  session.history.push(command);

  if (command === "die") process.exit(3);
  if (command === "hang") {
    await new Promise<void>((resolve) => {
      session.cancel = resolve;
    });
    return { stopReason: "cancelled" };
  }

  const toolCallId = randomUUID();
  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    },
  });
  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Run command",
      kind: "other",
      status: "in_progress",
      rawInput: { command },
    },
  });
  let output: string;
  let status: acp.ToolCallStatus = "completed";
  try {
    output = await runCommand(cx, sessionId, session, command);
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
    status = "failed";
  }
  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status,
      content: [{ type: "content", content: { type: "text", text: output } }],
    },
  });
  await say(cx, sessionId, output);
  await cx.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "usage_update",
      used: 1200,
      size: 8000,
      cost: { amount: 0.25, currency: "USD" },
    },
  });
  return { stopReason: "end_turn" };
}

acp
  .agent({ name: "alchemist-acp-fixture" })
  .onNotification(acp.methods.agent.mcp.message, mcp.handleNotification)
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: "fixture", version: "1.0.0" },
    agentCapabilities: { loadSession: true, mcpCapabilities: { acp: true } },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, { history: [], serverId: acpServerId(params.mcpServers) });
    return {
      sessionId,
      configOptions: [
        {
          type: "select" as const,
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "small",
          options: [
            { value: "small", name: "Small" },
            { value: "large", name: "Large" },
          ],
        },
        {
          type: "select" as const,
          id: "effort",
          name: "Effort",
          category: "thought_level",
          currentValue: "low",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
    };
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    const session = sessionOf(params.sessionId);
    session.serverId = acpServerId(params.mcpServers);
    for (const text of session.history) {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
      });
      await say(client, params.sessionId, `replayed ${text}`);
    }
    return {};
  })
  .onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: [] }))
  .onRequest(acp.methods.agent.session.prompt, ({ params, client }) => prompt(params, client))
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    sessions.get(params.sessionId)?.cancel?.();
  })
  .connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );
