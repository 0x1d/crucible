import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Persona definition: data, not code (spec D-04, §5.4.3). */
export interface Persona {
  id: string;
  name: string;
  language: string;
  /** Device-side wake word (WakeNet model); informational on the server. */
  wakeWord: string;
  tts: { provider: string; voice: string };
  emotionalRange: string[];
  personality: string;
}

const PERSONA_DIR = fileURLToPath(new URL("../../personas/", import.meta.url));

export async function loadPersona(id: string): Promise<Persona> {
  const raw = await readFile(`${PERSONA_DIR}${id}.json`, "utf8");
  return JSON.parse(raw) as Persona;
}

/** Voice style rules shared by all personas (spec §5.4.2, Speech Shaper rule 1). */
const VOICE_RULES = `Everything you write is spoken aloud by a text-to-speech voice on a small device.
- Answer conversationally and briefly: one to three sentences unless asked for more.
- Lead with the answer. For long topics give a short summary and offer to go on.
- No markdown, no lists, no headings, no code blocks, no emoji, no URLs.
- Write numbers, units and abbreviations the way they are spoken.
- Before you search or fetch anything on the web, first say one short sentence that you're looking it up.`;

export function buildSystemPrompt(persona: Persona): string {
  return `${persona.personality}\n\n${VOICE_RULES}`;
}
