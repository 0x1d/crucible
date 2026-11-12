// Stand-in for the temporal-reasoning MCP server (tests): same tool names, in-memory facts;
// memory_finalize_turn asks the client for a memory block via MCP sampling.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const facts = [];
const obj = (props, required) => ({ type: "object", properties: props, required });
const str = { type: "string" };
const TOOLS = [
  ["minigraf_query", obj({ datalog: str }, ["datalog"])],
  ["minigraf_transact", obj({ facts: str, reason: str, valid_at: str }, ["facts", "reason"])],
  ["minigraf_retract", obj({ facts: str, reason: str, mode: { type: "string", enum: ["close", "correct"] } }, ["facts", "reason"])],
  ["minigraf_rule", obj({ rule: str }, ["rule"])],
  ["minigraf_report_issue", obj({ description: str }, ["description"])],
  ["minigraf_ingest_git", obj({}, [])],
  ["memory_prepare_turn", obj({ user_message: str }, ["user_message"])],
  ["memory_finalize_turn", obj({ conversation_delta: str }, ["conversation_delta"])],
];
const server = new Server({ name: "fake-temporal-reasoning", version: "0" }, { capabilities: { tools: {} } });
const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }] });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(([name, inputSchema]) => ({ name, description: `fake ${name}`, inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = req.params.arguments ?? {};
  switch (req.params.name) {
    case "minigraf_transact":
      if (/:person\//.test(a.facts)) return text({ ok: false, error: "schema violations: unknown type 'person'" });
      facts.push(a.facts);
      return text({ ok: true, tx: String(facts.length) });
    case "minigraf_query":
      return text({ ok: true, results: facts.map((f) => [f]) });
    case "memory_prepare_turn": {
      const words = a.user_message.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const hits = facts.filter((f) => words.some((w) => f.toLowerCase().includes(w)));
      return text(hits.length ? `Relevant memory context:\n${hits.map((h) => `  ${h}`).join("\n")}` : "");
    }
    case "memory_finalize_turn": {
      const r = await server.createMessage({
        messages: [{ role: "user", content: { type: "text", text: `Extract.\n\n${a.conversation_delta}` } }],
        maxTokens: 512,
      });
      const block = r.content.type === "text" ? r.content.text : "";
      if (block && block !== "[]") facts.push(block);
      return text({ ok: true, stored_count: block && block !== "[]" ? 1 : 0, strategy: "agent" });
    }
    default:
      return text({ ok: true });
  }
});
await server.connect(new StdioServerTransport());
