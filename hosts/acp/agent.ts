#!/usr/bin/env node
/**
 * Minimal ACP agent (SDK example) for Alchemist Phase 0 stdio spike.
 */
import { isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

interface AgentSession {
  pendingPrompt: AbortController | null;
}

class ExampleAgent {
  private sessions = new Map<string, AgentSession>();

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (!isAbsolute(params.cwd)) {
      throw acp.RequestError.invalidParams(
        { cwd: params.cwd },
        `cwd must be an absolute path: ${params.cwd}`,
      );
    }

    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    this.sessions.set(sessionId, { pendingPrompt: null });
    return { sessionId };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    if (!this.sessions.has(params.sessionId)) {
      throw acp.RequestError.sessionNotFound(params.sessionId);
    }
    throw acp.RequestError.invalidParams(
      { modeId: params.modeId },
      `Unknown session mode ${params.modeId}`,
    );
  }

  async prompt(params: acp.PromptRequest, cx: acp.AgentContext): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.sessionNotFound(params.sessionId);
    }

    session.pendingPrompt?.abort();
    const pendingPrompt = new AbortController();
    session.pendingPrompt = pendingPrompt;

    const openToolCalls = new Set<string>();

    try {
      await this.simulateTurn(params.sessionId, pendingPrompt.signal, cx, openToolCalls);
    } catch (err) {
      if (!pendingPrompt.signal.aborted) {
        throw err;
      }
    } finally {
      for (const toolCallId of openToolCalls) {
        await cx.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "failed",
          },
        });
      }
    }

    if (pendingPrompt.signal.aborted) {
      return { stopReason: "cancelled" };
    }

    session.pendingPrompt = null;
    return { stopReason: "end_turn" };
  }

  private async simulateTurn(
    sessionId: string,
    abortSignal: AbortSignal,
    cx: acp.AgentContext,
    openToolCalls: Set<string>,
  ): Promise<void> {
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "ACP spike agent: hello from Alchemist hosts/acp/agent.ts.",
        },
      },
    });

    await this.delay(abortSignal, 200);

    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Reading README",
        kind: "read",
        status: "pending",
        locations: [{ path: "/project/README.md" }],
        rawInput: { path: "/project/README.md" },
      },
    });
    openToolCalls.add("call_1");

    await this.delay(abortSignal, 200);

    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_1",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "(mock read)" },
          },
        ],
      },
    });
    openToolCalls.delete("call_1");

    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " Done." },
      },
    });
  }

  private delay(abortSignal: AbortSignal, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (abortSignal.aborted) reject(new Error("aborted"));
        else resolve();
      }, ms);
    });
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);
const agent = new ExampleAgent();

acp
  .agent({ name: "alchemist-acp-example-agent" })
  .onRequest(acp.methods.agent.initialize, (ctx) => agent.initialize(ctx.params))
  .onRequest(acp.methods.agent.session.new, (ctx) => agent.newSession(ctx.params))
  .onRequest(acp.methods.agent.authenticate, (ctx) => agent.authenticate(ctx.params))
  .onRequest(acp.methods.agent.session.setMode, (ctx) => agent.setSessionMode(ctx.params))
  .onRequest(acp.methods.agent.session.prompt, (ctx) => agent.prompt(ctx.params, ctx.client))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => agent.cancel(ctx.params))
  .connect(stream);
