import { defineEval, includes } from "@grok/agent-sdk/evals";
import {
  seedSessionTraceMemory,
  sessionTraceMemoryPath,
} from "./lib/session-trace-memory.ts";

function memoryPathForCase(): string {
  return process.env.AGENT_MEMORY_PATH ?? sessionTraceMemoryPath;
}

/** `action.result.output` is the JSON text the model saw, not a parsed object. */
function codexCallOk(value: unknown): boolean {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { ok?: boolean }).ok === true
  );
}

export default defineEval({
  tags: ["session-trace", "memory"],
  description:
    "Replay the factory memory Q&A from ses_25eef044 (turns 1–4 only; no remember).",
  cases: [
    {
      id: "factory-qna",
      description: "Argo recap, stack, lighter orchestrator, git seams.",
      async test(t) {
        await seedSessionTraceMemory({ memoryPath: memoryPathForCase() });

        await t.send("what did we walk about argocd?");
        await t.send("what stack would you suggest based on my usecase?");
        await t.send("suggest a lighter stack then temporal");
        await t.send("where are the integration points with git");

        t.succeeded();
        t.calledTool("call_function", { input: { name: "memory.overview" } });
        t.calledTool("call_function", { input: { name: "memory.query" } });
        t.calledTool("call_function", { input: { name: "memory.remember" }, count: 0 });
        t.calledTool("call_function", { input: { name: "memory.transact" }, count: 0 });
        t.calledTool("call_function", { input: { name: "fs.read" }, count: 0 });
        t.calledTool("call_function", { input: { name: "sys.cmd" }, count: 0 });
        // overview + query per topical turn; id-only catalog needs both
        t.maxToolCalls(16);
      },
    },
    {
      id: "factory-remember",
      description: "After the Q&A thread, persist git integration points.",
      async test(t) {
        await seedSessionTraceMemory({ memoryPath: memoryPathForCase() });

        await t.send("what did we walk about argocd?");
        await t.send("what stack would you suggest based on my usecase?");
        await t.send("suggest a lighter stack then temporal");
        await t.send("where are the integration points with git");
        await t.send(
          [
            "remember these",
            "Persist the git integration points we just discussed for the lighter Restate factory stack.",
            "Use memory.remember with facts as {e,a,v} objects.",
            "Allowed attributes: description, rationale, depends-on, motivated-by only.",
            "Do not read repository source to infer the schema.",
          ].join(" "),
        );

        t.succeeded();
        t.calledTool("call_function", {
          input: { name: "memory.remember" },
          output: codexCallOk,
        });
        t.notCalledTool("load_function");
        t.notCalledTool("find_function");
        t.calledTool("call_function", { input: { name: "fs.read" }, count: 0 });
        t.calledTool("call_function", { input: { name: "sys.cmd" }, count: 0 });
        t.maxToolCalls(20);
        t.check(t.reply, includes(/remember|stored|saved|memory/i));
      },
    },
  ],
});
