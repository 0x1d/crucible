import type { SlashCommand } from "@earendil-works/pi-tui";

export const COMMANDS: SlashCommand[] = [
  { name: "host", description: "Select a host and a session" },
  { name: "session", description: "Select a session of the current host" },
  { name: "new", description: "Start a new session" },
  { name: "model", description: "Set the model", argumentHint: "[id]" },
  { name: "effort", description: "Set the effort level", argumentHint: "[level]" },
  { name: "diff", description: "Show the changes under functions/ in this run" },
  { name: "remember", description: "Store knowledge from this conversation in memory", argumentHint: "[instructions]" },
  { name: "exit", description: "Exit the TUI" },
];

export function parseCommand(text: string): { name: string; arg: string } | undefined {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  return match ? { name: match[1], arg: match[2].trim() } : undefined;
}
