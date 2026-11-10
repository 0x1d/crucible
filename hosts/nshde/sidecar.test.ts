import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSidecar } from "./sidecar.ts";
import { runSession, type QueryFn, type SessionEvent } from "./session.ts";

const sessionId = "11111111-2222-3333-4444-555555555555";

function message(value: Record<string, unknown>): SDKMessage {
  return { session_id: sessionId, parent_tool_use_id: null, ...value } as unknown as SDKMessage;
}

/** A scripted session: the agent writes one component and then answers. */
function scriptedQuery(seen: { prompt?: string; options?: Options }): QueryFn {
  return async function* (params) {
    seen.prompt = params.prompt;
    seen.options = params.options;
    yield message({ type: "system", subtype: "init" });
    yield message({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Writing the component." },
          {
            type: "tool_use",
            id: "tu_1",
            name: "mcp__alchemist__call_function",
            input: { name: "nshde.component.write", args: { slug: "greeting", source: "x" } },
          },
        ],
      },
    });
    yield message({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [{ type: "text", text: JSON.stringify({ ok: true, result: { path: "components/greeting.nsh.tsx" } }) }],
          },
        ],
      },
    });
    yield message({ type: "result", subtype: "success", result: "Done.", total_cost_usd: 0.01 });
  };
}

async function collect(events: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

test("maps a session to events and reports the written component", async () => {
  const seen: { prompt?: string; options?: Options } = {};
  const events = await collect(
    runSession(
      { prompt: "Build a greeting", agent: { id: "implementer", name: "Implementer", role: "Writes components" } },
      { query: scriptedQuery(seen) },
    ),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["session", "text", "tool", "tool_result", "component", "done"],
  );
  assert.deepEqual(events[0], { type: "session", sessionId });
  assert.deepEqual(events[2], {
    type: "tool",
    id: "tu_1",
    name: "call_function",
    input: { name: "nshde.component.write", args: { slug: "greeting", source: "x" } },
  });
  assert.deepEqual(events[4], { type: "component", path: "components/greeting.nsh.tsx" });
  assert.deepEqual(events[5], { type: "done", result: "Done.", costUsd: 0.01 });

  assert.equal(seen.prompt, "Build a greeting");
  // Built on the Claude host: codex tools only, no built-in tools.
  assert.deepEqual(seen.options?.tools, []);
  assert.ok(seen.options?.mcpServers?.alchemist);
  for (const name of ["find_function", "define_function", "load_function", "call_function"]) {
    assert.ok(seen.options?.allowedTools?.includes(`mcp__alchemist__${name}`), name);
  }
  const prompt = String(seen.options?.systemPrompt);
  assert.match(prompt, /# nshde agent instructions/);
  assert.match(prompt, /You act as the Implementer: Writes components/);
  assert.equal(seen.options?.resume, undefined);
});

test("resumes a session and reports failed tools without a component", async () => {
  const seen: { options?: Options } = {};
  const query: QueryFn = async function* (params) {
    seen.options = params.options;
    yield message({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "mcp__alchemist__call_function",
            input: { name: "nshde.component.write", args: { slug: "bad" } },
          },
        ],
      },
    });
    yield message({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            is_error: true,
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: "component does not compile" }) }],
          },
        ],
      },
    });
    yield message({ type: "result", subtype: "error_max_turns", errors: [] });
  };

  const events = await collect(runSession({ prompt: "again", sessionId }, { query }));
  assert.equal(seen.options?.resume, sessionId);
  assert.deepEqual(
    events.map((event) => event.type),
    ["session", "tool", "tool_result", "error"],
  );
  assert.deepEqual(events[2], { type: "tool_result", id: "tu_2", ok: false, error: "component does not compile" });
});

test("POST /sessions streams SSE", async () => {
  const server = createSidecar({ query: scriptedQuery({}) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/sessions`, { method: "POST", body: "{}" });
    assert.equal(bad.status, 400);

    const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Build a greeting" }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = await res.text();
    const names = [...body.matchAll(/^event: (\w+)$/gm)].map((match) => match[1]);
    assert.deepEqual(names, ["session", "text", "tool", "tool_result", "component", "done"]);
    assert.match(body, /data: \{"type":"component","path":"components\/greeting.nsh.tsx"\}/);

    const missing = await fetch(`http://127.0.0.1:${port}/other`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
