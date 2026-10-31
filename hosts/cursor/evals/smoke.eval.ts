import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "call_function can invoke the bundled echo Elixir tool.",
  async test(t) {
    await t.send(
      'Use call_function with name "echo" and args {"msg":"hello"}. Reply with only the result map.',
    );
    t.succeeded();
    t.calledTool("call_function");
  },
});
