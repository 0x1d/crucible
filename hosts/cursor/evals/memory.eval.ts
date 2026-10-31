import { defineEval, includes } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["memory"],
  description: "Record a decision in the belief graph and read it back.",
  async test(t) {
    await t.send(
      [
        "Use the belief graph.",
        'Call call_function on memory.transact with reason "eval fixture" and one fact:',
        'entity decision/eval_clock, attribute description, value "use a monotonic clock".',
        "Then call call_function on memory.query to find that description.",
        "Reply with the description value only.",
      ].join(" "),
    );

    t.succeeded();
    t.calledTool("call_function", {
      input: {
        name: "memory.transact",
        args: {
          facts: [{ e: "decision/eval_clock", v: "use a monotonic clock" }],
        },
      },
    });
    t.calledTool("call_function", {
      input: { name: "memory.query" },
      output: (value) => JSON.stringify(value).includes("monotonic clock"),
    });
    t.check(t.reply, includes(/monotonic clock/));
  },
});
