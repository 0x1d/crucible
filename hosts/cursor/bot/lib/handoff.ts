export const HANDOFF_BYTE_CAP = 12_000;

export const HANDOFF_REQUEST =
  "The context window is full. Call the handoff tool with the working set, then stop. Do not answer the user in this session.";

export const HANDOFF_PREAMBLE =
  "Continue this work from the handoff below. The prior transcript is not in this session.";

export const FORK_ABOVE_TOKENS = 200_000;

export type HandoffInput = {
  files?: string[];
  systems?: string[];
  pitfalls?: string[];
  state: string;
  next: string[];
  facts?: string[];
};

function section(title: string, items: string[] | undefined): string {
  if (!items?.length) return "";
  const body = items.map((item) => `- ${item}`).join("\n");
  return `## ${title}\n${body}\n\n`;
}

/** Renders the handoff markdown file from structured fields. */
export function renderHandoff(input: HandoffInput): string {
  const next = input.next.map((item) => `- ${item}`).join("\n");
  const text = `# Handoff

## State
${input.state}

## Next
${next}

${section("Files", input.files)}${section("Systems", input.systems)}${section("Pitfalls", input.pitfalls)}${section("Facts", input.facts)}`.trimEnd();
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > HANDOFF_BYTE_CAP) {
    throw new Error(`handoff.md would be ${bytes} bytes, over the ${HANDOFF_BYTE_CAP} byte cap.`);
  }
  return text;
}

export function seedMessage(file: string, userText: string): string {
  const trimmed = file.replace(/\n+$/, "");
  return `${HANDOFF_PREAMBLE}\n\n${trimmed}\n\n${userText}`;
}
