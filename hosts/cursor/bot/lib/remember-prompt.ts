/** Builds the /remember prompt. The marker line is the checkpoint for the next call. */
export function rememberPrompt(args: {
  sessionId: string | undefined;
  instructions: string;
  now: Date;
}): string {
  const lines = [
    `[memory-checkpoint ${args.now.toISOString()}]`,
    "Extract durable knowledge from this conversation since the previous",
    "[memory-checkpoint] message, or from the start if none exists.",
    "Store decisions, preferences, constraints, and dependencies with",
    "memory.remember.",
  ];
  if (args.sessionId) lines[lines.length - 1] += ` Set source_session to ${args.sessionId}.`;
  const extra = args.instructions.trim();
  if (extra) lines.push(extra);
  return lines.join("\n");
}
