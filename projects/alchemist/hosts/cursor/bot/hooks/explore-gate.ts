import { defineHook } from "@grok/agent-sdk/hooks";
import { resetExploreGate } from "../lib/explore-gate.ts";
import { sessionHarnessDir } from "../lib/session-workspace.ts";

export default defineHook({
  events: {
    "message.received"(_event, ctx) {
      resetExploreGate(sessionHarnessDir(ctx.stateRoot, ctx.session.id));
    },
  },
});
