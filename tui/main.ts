#!/usr/bin/env node
/**
 * Terminal UI for the Alchemist hosts.
 *
 *   npm run tui
 */
import { logFile } from "./log.ts";
import {
  Box,
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  ProcessTerminal,
  ScrollView,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
} from "@earendil-works/pi-tui";
import { repoRoot } from "../core/elixir-bridge.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import type { HostAdapter } from "./adapters/types.ts";
import { ChangeTracker } from "./changes.ts";
import { COMMANDS, parseCommand } from "./commands.ts";
import { rememberPrompt } from "./remember.ts";
import { SessionStats } from "./stats.ts";
import { type Theme, resolveTheme } from "./theme.ts";
import { Transcript, footerLine } from "./view.ts";

const HOSTS: Record<string, { description: string; create: () => HostAdapter }> = {
  claude: { description: "Claude Agent SDK", create: () => new ClaudeAdapter() },
};

let theme: Theme;
try {
  theme = resolveTheme(process.env.ALCHEMIST_TUI_THEME);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

const tui = new TuiAltScreen(new ProcessTerminal());
const transcript = new Transcript(theme);
const status = new Container();
const editor = new Editor(tui, theme.editor);
const footer = new Text("", 0, 0);
const changes = await ChangeTracker.start(repoRoot);

let adapter: HostAdapter | undefined;
let stats = new SessionStats();
let turn: AbortController | undefined;
let lastCtrlC = 0;

editor.setAutocompleteProvider(new CombinedAutocompleteProvider(COMMANDS, repoRoot));
// The transcript scrolls. Status, editor, and footer stay at the bottom of the screen.
tui.setLayoutRoot(
  new VStack([
    {
      component: new ScrollView(transcript, { follow: "end", primary: true }),
      basis: 0,
      grow: 1,
      minSize: 1,
    },
    { component: new VStack([status, editor, footer]), basis: "auto", shrink: 1, minSize: 1 },
  ]),
);

function render(): void {
  if (adapter) {
    footer.setText(
      footerLine(theme, { host: adapter.name, model: adapter.model, effort: adapter.effort, stats }),
    );
  }
  tui.requestRender();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shows a select list as an overlay. Resolves with the selected value, or undefined on Esc. */
function pick(title: string, items: SelectItem[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const box = new Box(2, 1, theme.bg.surface);
    const list = new SelectList(items, 12, theme.selectList);
    box.addChild(new Text(theme.bold(theme.fg.accent(title)), 0, 0));
    box.addChild(new Spacer(1));
    box.addChild(list);
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg.muted("↑↓ move · Enter select · Esc cancel"), 0, 0));
    const handle = tui.showOverlay(box, { width: "60%", minWidth: 50, maxHeight: "80%", anchor: "center" });
    tui.setFocus(list);
    const done = (value: string | undefined) => {
      handle.hide();
      tui.setFocus(editor);
      render();
      resolve(value);
    };
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    tui.requestRender();
  });
}

async function withStatus<T>(message: string, work: () => Promise<T>): Promise<T> {
  const loader = new Loader(tui, theme.fg.accent, theme.fg.muted, message);
  status.addChild(loader);
  loader.start();
  try {
    return await work();
  } finally {
    loader.stop();
    status.clear();
    render();
  }
}

async function openSession(id: string | undefined): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  const events = await withStatus("Loading session…", () => host.openSession(id));
  transcript.reset();
  for (const event of events) transcript.apply(event);
  transcript.info(id ? `Session ${id} on ${host.name}.` : `New session on ${host.name}.`);
  stats = id ? SessionStats.fromReplay(events) : new SessionStats();
  render();
}

async function selectSession(): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  let items: SelectItem[] = [{ value: "", label: "New session" }];
  try {
    const sessions = await withStatus("Loading sessions…", () => host.listSessions());
    items = items.concat(
      sessions.map((s) => ({
        value: s.id,
        label: s.title.replace(/\s+/g, " ").slice(0, 70),
        description: s.updatedAt.toLocaleString(),
      })),
    );
  } catch (error) {
    transcript.error(`Cannot list sessions: ${errorText(error)}`);
  }
  const id = await pick(`Sessions on ${host.name}`, items);
  if (id === undefined) return;
  await openSession(id || undefined);
}

async function selectHost(): Promise<boolean> {
  const items = Object.entries(HOSTS).map(([value, h]) => ({
    value,
    label: value,
    description: h.description,
  }));
  const name = await pick("Host", items);
  if (name === undefined) return false;
  if (adapter?.name !== name) {
    await adapter?.close();
    adapter = HOSTS[name].create();
    stats = new SessionStats();
    transcript.reset();
  }
  await selectSession();
  return true;
}

async function selectModel(): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  const models = await withStatus("Loading models…", () => host.listModels());
  const model = await pick(
    "Model",
    models.map((m) => ({ value: m.id, label: m.label, description: m.id })),
  );
  if (model === undefined) return;
  const efforts = models.find((m) => m.id === model)?.efforts ?? [];
  const effort = efforts.length
    ? await pick("Effort", efforts.map((e) => ({ value: e, label: e })))
    : undefined;
  host.setModel(model, effort ?? (efforts.includes(host.effort ?? "") ? host.effort : undefined));
  transcript.info(`Model ${model}${host.effort ? `, effort ${host.effort}` : ""}.`);
  render();
}

async function selectEffort(level: string): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  const models = await withStatus("Loading models…", () => host.listModels());
  const efforts =
    models.find((m) => m.id === host.model)?.efforts ??
    [...new Set(models.flatMap((m) => m.efforts))];
  const effort =
    level || (await pick("Effort", efforts.map((e) => ({ value: e, label: e }))));
  if (!effort) return;
  if (!efforts.includes(effort)) {
    transcript.error(`Unknown effort "${effort}". Use one of: ${efforts.join(", ")}.`);
  } else {
    host.setModel(host.model, effort);
    transcript.info(`Effort ${effort}.`);
  }
  render();
}

async function runTurn(prompt: string, shown: string): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  transcript.user(shown);
  turn = new AbortController();
  editor.disableSubmit = true;
  const loader = new Loader(tui, theme.fg.accent, theme.fg.muted, "Working… (Esc to stop)");
  status.addChild(loader);
  loader.start();
  const started = Date.now();
  render();
  try {
    for await (const event of host.send(prompt, turn.signal)) {
      transcript.apply(event);
      stats.apply(event);
      if (event.type === "tool_result") {
        for (const change of await changes.refresh()) transcript.change(change);
      }
      render();
    }
  } catch (error) {
    transcript.error(errorText(error));
  } finally {
    if (turn.signal.aborted) transcript.info("Stopped.");
    loader.stop();
    status.clear();
    stats.lastTurnMs = Date.now() - started;
    turn = undefined;
    editor.disableSubmit = false;
    render();
  }
}

async function shutdown(): Promise<never> {
  turn?.abort();
  tui.stop();
  await adapter?.close();
  process.exit(0);
}

async function handleCommand(name: string, arg: string): Promise<void> {
  switch (name) {
    case "host":
      await selectHost();
      break;
    case "session":
      await selectSession();
      break;
    case "new":
      await openSession(undefined);
      break;
    case "model":
      if (arg) {
        adapter?.setModel(arg, adapter.effort);
        transcript.info(`Model ${arg}.`);
        render();
      } else {
        await selectModel();
      }
      break;
    case "effort":
      await selectEffort(arg);
      break;
    case "diff": {
      const diff = await changes.diff();
      if (diff) transcript.diff(diff.trimEnd());
      else transcript.info("No changes under functions/ in this run.");
      render();
      break;
    }
    case "remember":
      await runTurn(
        rememberPrompt({ sessionId: adapter?.sessionId, instructions: arg, now: new Date() }),
        `/remember${arg ? ` ${arg}` : ""}`,
      );
      break;
    case "exit":
      await shutdown();
      break;
    default:
      transcript.error(`Unknown command /${name}.`);
      render();
  }
}

editor.onSubmit = (text) => {
  const prompt = text.trim();
  if (!prompt || turn) return;
  editor.addToHistory(prompt);
  editor.setText("");
  const command = parseCommand(prompt);
  const work = command ? handleCommand(command.name, command.arg) : runTurn(prompt, prompt);
  work.catch((error) => {
    transcript.error(errorText(error));
    render();
  });
};

tui.addInputListener((data) => {
  if (matchesKey(data, "escape") && turn) {
    turn.abort();
    return { consume: true };
  }
  if (matchesKey(data, "ctrl+c")) {
    if (turn) {
      turn.abort();
    } else if (Date.now() - lastCtrlC < 2000) {
      void shutdown();
    } else {
      lastCtrlC = Date.now();
      transcript.info("Press Ctrl+C again to exit.");
      render();
    }
    return { consume: true };
  }
  if (matchesKey(data, "ctrl+o")) {
    transcript.toggleTools();
    render();
    return { consume: true };
  }
  if (matchesKey(data, "ctrl+t")) {
    transcript.toggleReasoning();
    render();
    return { consume: true };
  }
  if (matchesKey(data, "ctrl+p") && !turn && !tui.hasOverlay()) {
    selectModel().catch((error) => transcript.error(errorText(error)));
    return { consume: true };
  }
  return undefined;
});

tui.setFocus(editor);
tui.start();
transcript.info(`Alchemist TUI · theme ${theme.name} · log ${logFile}`);
if (!(await selectHost())) await shutdown();
