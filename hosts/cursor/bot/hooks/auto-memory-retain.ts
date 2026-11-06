import { defineHook } from "@grok/agent-sdk/hooks";
import {
  autoMemoryRetainTurnKey,
  seedAutoRetainTurnCounter,
} from "../lib/auto-memory-retain-kv.ts";
import { loadMemoryExploreSettings } from "../lib/host-flags.ts";
import { rememberPrompt } from "../lib/remember-prompt.ts";

/** Same interval rule as `tui/auto-memory-retain.ts`. */
function shouldAutoRetain(
  completedTurns: number,
  settings: ReturnType<typeof loadMemoryExploreSettings>,
): boolean {
  const every = settings.memoryRetainEveryTurns;
  if (!settings.memoryAutoRetain || every < 1) return false;
  return completedTurns > 0 && completedTurns % every === 0;
}

export default defineHook({
  events: {
    async "message.received"(_event, ctx) {
      await seedAutoRetainTurnCounter(ctx);
    },
    async "turn.completed"(_event, ctx) {
      const settings = loadMemoryExploreSettings(ctx.stateRoot);
      if (!settings.memoryAutoRetain || settings.memoryRetainEveryTurns < 1) return;

      const key = autoMemoryRetainTurnKey(ctx.session.id);
      const prev = await ctx.host.kv.get(key);
      const completedTurns = (typeof prev === "number" ? prev : 0) + 1;
      await ctx.host.kv.put(key, completedTurns);

      if (!shouldAutoRetain(completedTurns, settings)) return;

      const reminders = ctx.host.reminders;
      const token = ctx.channel.continuationToken;
      if (!reminders || !token) return;

      const prompt = rememberPrompt({
        sessionId: ctx.session.id,
        instructions: "",
        now: new Date(),
      });

      const reminder = await reminders.create({
        purpose: "auto-memory-retain",
        channelId: ctx.channel.id,
        continuationToken: token,
        prompt,
        delay: 1,
        busyPolicy: "queueBehindTurn",
      });
      await reminders.dispatch(reminder.id);
    },
  },
});
