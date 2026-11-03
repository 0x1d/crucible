import {
  type Component,
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { HostEvent } from "./adapters/types.ts";
import type { FileChange } from "./changes.ts";
import { SessionStats, formatTokens } from "./stats.ts";
import type { Theme } from "./theme.ts";

/** Context, cache result, cache read/write, and new tokens for one turn. */
export function tokenStatsLine(theme: Theme, stats: SessionStats): string {
  const sep = theme.fg.muted(" · ");
  const hit = stats.cacheHit();
  const cache = theme.fg.success;
  const parts = [
    theme.contextColor(stats.contextTokens)(stats.contextLabel()),
    ...(hit === undefined
      ? []
      : [
          hit ? cache("hit") : theme.fg.warning("miss"),
          cache(`read ${formatTokens(stats.cacheReadTokens ?? 0)}`),
          cache(`write ${formatTokens(stats.cacheWriteTokens ?? 0)}`),
          theme.fg.accent(`new ${formatTokens(stats.newTokens() ?? 0)}`),
        ]),
  ];
  return parts.join(sep);
}

export function footerLine(
  theme: Theme,
  state: { host: string; model: string | undefined; effort: string | undefined; stats: SessionStats },
): string {
  const { stats } = state;
  const sep = theme.fg.muted(" · ");
  const parts = [
    theme.bold(theme.fg.accent(state.host)),
    theme.fg.muted(state.model ?? "default"),
    ...(state.effort ? [theme.fg.muted(state.effort)] : []),
    tokenStatsLine(theme, stats),
    (stats.costComplete ? theme.fg.muted : theme.fg.warning)(stats.costLabel()),
  ];
  const turn = stats.turnLabel();
  if (turn) parts.push(theme.fg.muted(turn));
  return parts.join(sep);
}

export function changeLine(theme: Theme, change: FileChange): string {
  return [
    theme.fg.accent("✎"),
    change.path,
    theme.fg.success(`+${change.added}`),
    theme.fg.error(`−${change.removed}`),
  ].join(" ");
}

export function colorDiff(theme: Theme, diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return theme.bold(line);
      if (line.startsWith("+")) return theme.fg.success(line);
      if (line.startsWith("-")) return theme.fg.error(line);
      if (line.startsWith("@@")) return theme.fg.secondary(line);
      return line;
    })
    .join("\n");
}

function indent(text: string, width: number): string[] {
  return text
    .split("\n")
    .flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 4)))
    .map((line) => `    ${line}`);
}

/** One tool call: 1 line when collapsed, input and output when expanded. */
export class ToolLine implements Component {
  expanded = false;
  private status: "run" | "ok" | "fail" = "run";
  private output = "";
  private readonly theme: Theme;
  private readonly name: string;
  private readonly input: unknown;

  constructor(theme: Theme, name: string, input: unknown) {
    this.theme = theme;
    this.name = name;
    this.input = input;
  }

  finish(ok: boolean, output: string): void {
    this.status = ok ? "ok" : "fail";
    this.output = output;
  }

  render(width: number): string[] {
    const { fg } = this.theme;
    const marker = { run: fg.muted("▸"), ok: fg.success("✓"), fail: fg.error("✗") }[this.status];
    const head = `${marker} ${fg.secondary(this.name)} ${fg.muted(JSON.stringify(this.input ?? {}))}`;
    const lines = [truncateToWidth(head, width)];
    if (this.expanded) {
      lines.push(...indent(fg.muted(JSON.stringify(this.input ?? {}, null, 2)), width));
      if (this.output) lines.push(...indent(this.output, width));
    }
    return lines;
  }

  invalidate(): void {}
}

/** Reasoning text that the user can hide. */
class Reasoning implements Component {
  text = "";
  private readonly view: Transcript;

  constructor(view: Transcript) {
    this.view = view;
  }

  render(width: number): string[] {
    if (!this.view.showReasoning || !this.text) return [];
    const style = (s: string) => this.view.theme.italic(this.view.theme.fg.muted(s));
    return this.text.split("\n").flatMap((line) => wrapTextWithAnsi(style(line), width));
  }

  invalidate(): void {}
}

/** The scrollback of the conversation. */
export class Transcript extends Container {
  showReasoning = true;
  readonly theme: Theme;
  private expanded = false;
  private reply: { component: Markdown; text: string } | undefined;
  private reasoning: Reasoning | undefined;
  private readonly tools = new Map<string, ToolLine>();
  /** Usage gathered since the previous token line. */
  private turnUsage = new SessionStats();
  private turnHasContext = false;

  constructor(theme: Theme) {
    super();
    this.theme = theme;
  }

  reset(): void {
    this.clear();
    this.tools.clear();
    this.endBlock();
    this.clearTurnUsage();
  }

  /**
   * Appends this turn's token line under the reply.
   * A second call does nothing until the next turn reports a context size.
   */
  endTurn(): void {
    this.endBlock();
    if (!this.turnHasContext) return;
    this.addChild(new Text(tokenStatsLine(this.theme, this.turnUsage), 0, 0));
    this.clearTurnUsage();
  }

  user(text: string): void {
    this.endBlock();
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg.muted(`you> ${text}`), 0, 0));
  }

  info(text: string): void {
    this.endBlock();
    this.addChild(new Text(this.theme.fg.muted(text), 0, 0));
  }

  error(text: string): void {
    this.endBlock();
    this.addChild(new Text(this.theme.fg.error(`error: ${text}`), 0, 0));
  }

  change(change: FileChange): void {
    this.endBlock();
    this.addChild(new Text(changeLine(this.theme, change), 0, 0));
  }

  diff(text: string): void {
    this.endBlock();
    this.addChild(new Text(colorDiff(this.theme, text), 0, 0));
  }

  apply(event: HostEvent): void {
    switch (event.type) {
      case "user":
        this.endTurn();
        this.user(event.text);
        break;
      case "text":
        if (!this.reply) {
          this.reply = { component: new Markdown("", 0, 0, this.theme.markdown), text: "" };
          this.addChild(this.reply.component);
        }
        this.reply.text += event.delta;
        this.reply.component.setText(this.reply.text);
        break;
      case "reasoning":
        if (!this.reasoning) {
          this.reasoning = new Reasoning(this);
          this.addChild(this.reasoning);
        }
        this.reasoning.text += event.delta;
        break;
      case "tool": {
        this.endBlock();
        const tool = new ToolLine(this.theme, event.name, event.input);
        tool.expanded = this.expanded;
        this.tools.set(event.id, tool);
        this.addChild(tool);
        break;
      }
      case "tool_result":
        this.tools.get(event.id)?.finish(event.ok, event.output);
        break;
      case "error":
        this.endTurn();
        this.error(event.message);
        break;
      case "done":
        this.endTurn();
        break;
      case "usage":
        this.turnUsage.apply(event);
        if (event.contextTokens !== undefined) this.turnHasContext = true;
        break;
    }
  }

  toggleTools(): void {
    this.expanded = !this.expanded;
    for (const tool of this.tools.values()) tool.expanded = this.expanded;
  }

  toggleReasoning(): void {
    this.showReasoning = !this.showReasoning;
  }

  private endBlock(): void {
    this.reply = undefined;
    this.reasoning = undefined;
  }

  private clearTurnUsage(): void {
    this.turnUsage = new SessionStats();
    this.turnHasContext = false;
  }
}
