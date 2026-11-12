import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { alchemistOptions, instructions as alchemistInstructions } from "../claude/codex.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const nshdeInstructions = fs.readFileSync(path.join(here, "instructions.md"), "utf8").trim();

/** The role nshde chose on the composer (Architect, Implementer, Reviewer). */
export interface SessionRole {
  id: string;
  name?: string;
  role?: string;
}

export interface SessionRequest {
  prompt: string;
  /** Claude session to resume. The sidecar returns it in the `session` event. */
  sessionId?: string;
  agent?: SessionRole;
}

/** Events streamed to nshde, one per SSE message. */
export type SessionEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; error?: string }
  | { type: "component"; path: string }
  | { type: "done"; result?: string; costUsd?: number }
  | { type: "error"; message: string };

export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export interface SessionDeps {
  query: QueryFn;
  /** Claude host options to build on. Defaults to `alchemistOptions()` from `hosts/claude/codex.ts`. */
  baseOptions?: () => Options;
  abortController?: AbortController;
  model?: string;
}

/** The Claude host prompt, then the nshde prompt, then the role nshde chose. */
export function systemPrompt(agent?: SessionRole): string {
  const base = `${alchemistInstructions.trim()}\n\n${nshdeInstructions}`;
  if (!agent?.name) return base;
  const role = agent.role ? `: ${agent.role}` : "";
  return `${base}\n\n## Role\n\nYou act as the ${agent.name}${role}.`;
}

const toolPrefix = "mcp__alchemist__";

function shortName(name: string): string {
  return name.startsWith(toolPrefix) ? name.slice(toolPrefix.length) : name;
}

type Block = { type: string; [key: string]: unknown };

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("");
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Finds the written path in a codex `call` result, whichever envelope the runtime uses. */
function writtenPath(result: unknown): string | undefined {
  let current = result;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const value = current as Record<string, unknown>;
    if (typeof value.path === "string") return value.path;
    current = value.result ?? value.value ?? value.data;
  }
  return undefined;
}

function componentPathFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const { slug, path: file } = args as { slug?: unknown; path?: unknown };
  if (typeof file === "string") return file;
  if (typeof slug === "string") return `components/${slug}.nsh.tsx`;
  return undefined;
}

/**
 * Runs one turn of a Claude Agent SDK session with the Claude host's options
 * (codex tools only, no built-in tools, no local settings) and maps its
 * messages to `SessionEvent`s. A successful `nshde.component.write`
 * call also yields a `component` event so nshde can hot-mount the file.
 */
export async function* runSession(
  request: SessionRequest,
  deps: SessionDeps,
): AsyncGenerator<SessionEvent> {
  const pending = new Map<string, { name: string; input: unknown }>();
  const options: Options = {
    ...(deps.baseOptions ?? alchemistOptions)(),
    systemPrompt: systemPrompt(request.agent),
    abortController: deps.abortController,
    ...(request.sessionId ? { resume: request.sessionId } : {}),
    ...(deps.model ? { model: deps.model } : {}),
  };

  let announced = false;
  try {
    for await (const message of deps.query({ prompt: request.prompt, options })) {
      if (!announced && "session_id" in message && typeof message.session_id === "string") {
        announced = true;
        yield { type: "session", sessionId: message.session_id };
      }

      if (message.type === "assistant") {
        if (message.parent_tool_use_id) continue;
        for (const block of blocks(message.message.content)) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            yield { type: "text", text: block.text };
          } else if (block.type === "tool_use") {
            const id = String(block.id);
            const name = shortName(String(block.name));
            pending.set(id, { name, input: block.input });
            yield { type: "tool", id, name, input: block.input };
          }
        }
      } else if (message.type === "user") {
        for (const block of blocks(message.message.content)) {
          if (block.type !== "tool_result") continue;
          const id = String(block.tool_use_id);
          const call = pending.get(id);
          pending.delete(id);
          const text = resultText(block.content);
          const parsed = parse(text);
          const failed =
            block.is_error === true ||
            (typeof parsed === "object" && parsed !== null && (parsed as { ok?: unknown }).ok === false);
          const error = failed
            ? String((parsed as { error?: unknown } | undefined)?.error ?? text).slice(0, 2000)
            : undefined;
          yield { type: "tool_result", id, ok: !failed, ...(error ? { error } : {}) };

          const input = call?.input as { name?: unknown; args?: unknown } | undefined;
          if (!failed && call?.name === "call_function" && input?.name === "nshde.component.write") {
            const file = writtenPath(parsed) ?? componentPathFromArgs(input.args);
            if (file) yield { type: "component", path: file };
          }
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          yield { type: "done", result: message.result, costUsd: message.total_cost_usd };
        } else {
          const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
          yield { type: "error", message: errors.join("\n") || `session ended: ${message.subtype}` };
        }
        return;
      }
    }
    yield { type: "done" };
  } catch (error) {
    if (deps.abortController?.signal.aborted) return;
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
