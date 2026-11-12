import { parseCommand } from "./commands.ts";

/** Messages the user submits while a turn is still running. */
export type QueuedMessage = { prompt: string; shown: string };

/** Maps editor text to the prompt the host receives and the line shown in the transcript. */
export function buildQueuedMessage(
  text: string,
  rememberPrompt: (instructions: string) => string,
): QueuedMessage {
  const command = parseCommand(text);
  if (command?.name === "remember") {
    return {
      shown: `/remember${command.arg ? ` ${command.arg}` : ""}`,
      prompt: rememberPrompt(command.arg),
    };
  }
  return { shown: text, prompt: text };
}

export class FollowUpQueue {
  private readonly items: QueuedMessage[] = [];

  enqueue(item: QueuedMessage): number {
    this.items.push(item);
    return this.items.length;
  }

  shift(): QueuedMessage | undefined {
    return this.items.shift();
  }

  unshift(item: QueuedMessage): void {
    this.items.unshift(item);
  }

  get length(): number {
    return this.items.length;
  }

  /** Current queue order for display (oldest first). */
  snapshot(): readonly QueuedMessage[] {
    return this.items;
  }

  clear(): void {
    this.items.length = 0;
  }
}
