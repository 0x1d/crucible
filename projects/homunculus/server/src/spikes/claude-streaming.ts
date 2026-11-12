// Phase 0 spike (p0c): verify Claude Agent SDK partial streaming and interrupt,
// and measure time to first text / first speakable sentence.
//
//   pnpm spike:claude
//
// Auth: ANTHROPIC_API_KEY if set, otherwise the logged-in Claude Code subscription.
// Optional: HOMUNCULUS_MODEL, HOMUNCULUS_EFFORT (low|medium|high|xhigh|max).
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentBackend } from "../inference/claude/backend.js";
import type { AgentSession } from "../inference/types.js";
import { buildSystemPrompt, loadPersona } from "../persona/persona.js";

const SENTENCE_END = /[.!?](\s|$)/;

interface TurnResult {
  text: string;
  firstTextMs?: number;
  firstSentenceMs?: number;
  totalMs: number;
  interrupted: boolean;
  tools: string[];
  costUsd?: number;
}

async function turn(
  session: AgentSession,
  text: string,
  opts: { interruptAfterMs?: number; heardSoFar?: string } = {},
): Promise<TurnResult> {
  const t0 = performance.now();
  const r: TurnResult = { text: "", totalMs: 0, interrupted: false, tools: [] };
  let timer: NodeJS.Timeout | undefined;
  let interruptAt: number | undefined;
  if (opts.interruptAfterMs !== undefined) {
    timer = setTimeout(() => {
      interruptAt = performance.now();
      void session.interrupt();
    }, opts.interruptAfterMs);
  }
  process.stdout.write(`\n> ${text}\n< `);
  for await (const ev of session.send({ kind: "utterance", text, heardSoFar: opts.heardSoFar })) {
    const now = performance.now() - t0;
    if (ev.type === "text.delta") {
      r.firstTextMs ??= now;
      r.text += ev.text;
      if (r.firstSentenceMs === undefined && SENTENCE_END.test(r.text)) r.firstSentenceMs = now;
      process.stdout.write(ev.text);
    } else if (ev.type === "tool.start") {
      r.tools.push(ev.name);
      process.stdout.write(` [tool: ${ev.name}] `);
    } else if (ev.type === "done") {
      r.interrupted = ev.interrupted ?? false;
      r.costUsd = ev.usage?.costUsd;
    } else if (ev.type === "error") {
      throw new Error(`agent error: ${ev.message}`);
    }
  }
  clearTimeout(timer);
  r.totalMs = performance.now() - t0;
  process.stdout.write("\n");
  if (interruptAt !== undefined) {
    console.log(`  interrupt → turn ended in ${Math.round(performance.now() - interruptAt)} ms`);
  }
  return r;
}

function report(label: string, r: TurnResult): void {
  const ms = (v?: number) => (v === undefined ? "-" : `${Math.round(v)} ms`);
  console.log(
    `  [${label}] first text ${ms(r.firstTextMs)}, first sentence ${ms(r.firstSentenceMs)}, ` +
      `total ${ms(r.totalMs)}, interrupted=${r.interrupted}, tools=[${r.tools.join(", ")}]` +
      (r.costUsd !== undefined ? `, cumulative cost $${r.costUsd.toFixed(4)}` : ""),
  );
}

const persona = await loadPersona("claudia");
const model = process.env.HOMUNCULUS_MODEL ?? "claude-opus-5-5";
const effort = (process.env.HOMUNCULUS_EFFORT ?? "low") as EffortLevel;
const backend = new ClaudeAgentBackend({
  model,
  effort,
  tools: ["WebSearch", "WebFetch"],
  cwd: fileURLToPath(new URL("../../.data/sandbox/spike", import.meta.url)),
});
console.log(`model=${model} effort=${effort}`);

const tOpen = performance.now();
const session = await backend.openSession({ systemPrompt: buildSystemPrompt(persona) });
console.log(`session opened in ${Math.round(performance.now() - tOpen)} ms (process spawn is lazy)`);

try {
  // 1. Cold turn (includes process start-up).
  report("cold", await turn(session, "Hello Claudia, who are you?"));
  // 2. Warm turn: the latency that matters for normal conversation.
  report("warm", await turn(session, "What's the capital of Australia, and why isn't it Sydney?"));
  // 3. Barge-in: interrupt a long answer after 3 s.
  const long = await turn(session, "Tell me the full history of the Roman Empire in detail.", {
    interruptAfterMs: 3000,
  });
  report("interrupt", long);
  // 4. Session still usable after interrupt, with spoken-so-far context.
  report(
    "after-interrupt",
    await turn(session, "Sorry, never mind. What were you talking about just now?", {
      heardSoFar: long.text.slice(0, 120),
    }),
  );
  // 5. Tool use (web search).
  report("web-search", await turn(session, "What's the weather in Vienna today?"));
  console.log(`\nsession id: ${session.sessionId}`);
} finally {
  await session.close();
}
