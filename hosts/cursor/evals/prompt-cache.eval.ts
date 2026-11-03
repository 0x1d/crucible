import { defineEval, satisfies } from "@grok/agent-sdk/evals";

import { contextTokens } from "../../../tui/adapters/cursor.ts";

export default defineEval({
  tags: ["context", "cache"],
  description: "Follow-up reuses the pinned model prompt prefix.",
  timeoutMs: 120_000,
  cases: [
    {
      id: "pong",
      description: "Second turn cache read approaches the first prompt size.",
      async test(t) {
        process.env.ALCHEMIST_CTX_pinnedModel = "1";
        const first = await t.send("Reply with exactly the word pong and nothing else.");
        const second = await t.send("Reply with exactly the word pong2 and nothing else.");
        const usage = (events: typeof first.events) => {
          const completed = events
            .slice()
            .reverse()
            .find((event) => event.type === "turn.completed");
          return completed?.data.usage;
        };
        const u1 = usage(first.events);
        const u2 = usage(second.events);
        const prompt1 = u1 ? contextTokens(u1) : -1;
        const prompt2 = u2 ? contextTokens(u2) : -1;
        const cache1 = u1?.cacheReadTokens ?? -1;
        const cache2 = u2?.cacheReadTokens ?? -1;
        t.metric("prompt1", prompt1);
        t.metric("prompt2", prompt2);
        t.metric("cache1", cache1);
        t.metric("cache2", cache2);
        t.succeeded();
        t.maxToolCalls(0);
        t.check(
          prompt1,
          satisfies(
            (value) => typeof value === "number" && value >= 0 && value <= 16_000,
            "prompt1 <= 16000",
          ),
        );
        t.check(
          prompt2,
          satisfies(
            (value) => typeof value === "number" && value >= 0 && value <= 16_000,
            "prompt2 <= 16000",
          ),
        );
        t.check(
          prompt2,
          satisfies(
            (value) => typeof value === "number" && prompt1 >= 0 && value <= prompt1 + 1_000,
            "prompt2 <= prompt1 + 1000",
          ),
        );
        t.check(
          cache2,
          satisfies(
            (value) => typeof value === "number" && prompt1 >= 0 && value >= prompt1 - 1_000,
            "cache2 >= prompt1 - 1000",
          ),
        );
      },
    },
  ],
});
