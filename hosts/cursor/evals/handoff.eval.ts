import { defineEval, satisfies } from "@grok/agent-sdk/evals";

import { contextTokens } from "../../../tui/adapters/cursor.ts";
import { NAMED_READ_INPUT_TOKEN_BUDGET } from "./context-size.eval.ts";

export default defineEval({
  tags: ["context", "handoff"],
  description: "Compact ask calls the handoff tool within the named-read budget.",
  timeoutMs: 120_000,
  cases: [
    {
      id: "compact",
      description: "The model writes handoff.md when asked to compact.",
      async test(t) {
        process.env.ALCHEMIST_CTX_handoffTool = "1";
        const turn = await t.send("Compact the context.");
        const usage = turn.events
          .slice()
          .reverse()
          .find((event) => event.type === "turn.completed")?.data.usage;
        const inputTokens = usage ? contextTokens(usage) : -1;
        t.succeeded();
        t.calledTool("handoff");
        t.check(
          t.reply,
          satisfies(
            (value) => typeof value === "string" && !value.includes("/new"),
            "reply must not mention /new",
          ),
        );
        t.check(
          inputTokens,
          satisfies(
            (value) =>
              typeof value === "number" && value >= 0 && value <= NAMED_READ_INPUT_TOKEN_BUDGET,
            `input tokens <= ${NAMED_READ_INPUT_TOKEN_BUDGET}`,
          ),
        );
        t.metric("inputTokens", inputTokens);
      },
    },
  ],
});
