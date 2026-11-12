#!/usr/bin/env node
/**
 * Terminal UI for the Alchemist hosts.
 *
 *   pnpm run tui
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
import type { RequestPermissionOutcome, RequestPermissionRequest } from "@agentclientprotocol/sdk/unstable";
import { AcpClientAdapter } from "./adapters/acp.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import { CursorAdapter } from "./adapters/cursor.ts";
import type { HostAdapter } from "./adapters/types.ts";
import { ChangeTracker } from "./changes.ts";
import { COMMANDS, parseCommand } from "./commands.ts";
import { applyHostFlagsCommand, asHostId, defaultStateRoot, loadMemoryExploreSettings } from "./host-flags.ts";
import { shouldAutoRetain } from "./auto-memory-retain.ts";
import { rememberPrompt } from "./remember.ts";
import { SessionStats } from "./stats.ts";
import { type Theme, resolveTheme } from "./theme.ts";
import { FollowUpQueue, buildQueuedMessage } from "./follow-up-queue.ts";
import {
  loadAcpHosts,
  parseHostPickerValue,
  probedAgentSelectItems,
  sdkHostValue,
  unavailableReason,
} from "./acp-host-picker.ts";
import { Transcript, followUpQueueLines, footerLine } from "./view.ts";

const HOSTS: Record<string, { description: string; create: () => HostAdapter }> = {
  claude: { description: "Claude Agent SDK", create: () => new ClaudeAdapter() },
  cursor: { description: "Cursor Agent SDK", create: () => new CursorAdapter() },
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
const queueBar = new Text("", 0, 0);
const editor = new Editor(tui, theme.editor);
const footer = new Text("", 0, 0);
const changes = await ChangeTracker.start(repoRoot);

let adapter: HostAdapter | undefined;
let stats = new SessionStats();
let turn: AbortController | undefined;
let drainingFollowUps = false;
const followUpQueue = new FollowUpQueue();
let lastCtrlC = 0;
let completedTurns = 0;

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
    { component: new VStack([status, queueBar, editor, footer]), basis: "auto", shrink: 1, minSize: 1 },
  ]),
);

function render(): void {
  const queued = followUpQueue.snapshot();
  queueBar.setText(
    followUpQueueLines(theme, queued, {
      injectHint: queued.length > 0 && turn !== undefined && adapter?.inject !== undefined,
    }),
  );
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

/**
 * Shows a select list as an overlay. Resolves with the selected value, or undefined on Esc
 * or when `signal` aborts.
 */
function pick(title: string, items: SelectItem[], signal?: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }
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
      signal?.removeEventListener("abort", cancel);
      handle.hide();
      tui.setFocus(editor);
      render();
      resolve(value);
    };
    const cancel = () => done(undefined);
    signal?.addEventListener("abort", cancel, { once: true });
    list.onSelect = (item) => done(item.value);
    list.onCancel = cancel;
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

/** Asks the user to answer an ACP agent's permission request. */
async function pickPermission(
  request: RequestPermissionRequest,
  signal: AbortSignal,
): Promise<RequestPermissionOutcome> {
  const optionId = await pick(
    `Allow: ${request.toolCall.title ?? "tool call"}`,
    request.options.map((o) => ({ value: o.optionId, label: o.name, description: o.kind })),
    signal,
  );
  return optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId };
}

async function openSession(id: string | undefined): Promise<void> {
  if (!adapter) return;
  clearFollowUpQueue("Cleared queued messages for the new session.");
  const host = adapter;
  const events = await withStatus("Loading session…", () => host.openSession(id));
  transcript.reset();
  for (const event of events) transcript.apply(event);
  transcript.endTurn();
  transcript.info(id ? `Session ${id} on ${host.name}.` : `New session on ${host.name}.`);
  if (host.notice) transcript.info(host.notice);
  stats = id ? SessionStats.fromReplay(events) : new SessionStats();
  completedTurns = id
    ? events.filter((e) => e.type === "done").length
    : 0;
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
  try {
    await openSession(id || undefined);
  } catch (error) {
    transcript.error(`Cannot open the session: ${errorText(error)}`);
    render();
  }
}

async function selectHost(): Promise<boolean> {
  const sdkItems = Object.entries(HOSTS).map(([name, h]) => ({
    value: sdkHostValue(name),
    label: name,
    description: `SDK · ${h.description}`,
  }));
  let acpAgents: Awaited<ReturnType<typeof loadAcpHosts>> = [];
  try {
    acpAgents = await withStatus("Probing ACP agents…", () => loadAcpHosts(repoRoot, repoRoot));
  } catch (error) {
    transcript.error(`ACP discovery failed: ${errorText(error)}`);
  }
  const picked = await pick("Host", [...sdkItems, ...probedAgentSelectItems(acpAgents)]);
  if (picked === undefined) return false;

  const hostChoice = parseHostPickerValue(picked);
  if (!hostChoice) {
    transcript.error(`Unknown host selection: ${picked}`);
    render();
    return false;
  }

  let adapterName: string;
  let createAdapter: () => HostAdapter;
  if (hostChoice.kind === "acp") {
    const agent = acpAgents.find((a) => a.id === hostChoice.id);
    const unavailable = agent ? unavailableReason(agent) : "not found";
    if (!agent || unavailable) {
      transcript.error(`ACP agent "${hostChoice.id}" is unavailable: ${unavailable}`);
      render();
      return selectHost();
    }
    adapterName = `acp:${agent.id}`;
    createAdapter = () => new AcpClientAdapter(agent, { requestPermission: pickPermission });
  } else {
    const name = hostChoice.name;
    if (!(name in HOSTS)) {
      transcript.error(`Unknown SDK host: ${name}`);
      render();
      return false;
    }
    adapterName = name;
    createAdapter = HOSTS[name].create;
  }
  if (adapter?.name !== adapterName) {
    await adapter?.close();
    adapter = createAdapter();
    stats = new SessionStats();
    transcript.reset();
    clearFollowUpQueue("Cleared queued messages for the new host.");
    // Each SDK adapter restores its saved model from its own host-flags.json.
  }
  await selectSession();
  return true;
}

function assignModel(model: string | undefined, effort: string | undefined): void {
  if (!adapter) return;
  const host = adapter;
  const previousId = host.sessionId;
  const changed = model !== host.model || effort !== host.effort;
  host.setModel(model, effort);
  const label = `${host.model ?? "auto"}${host.effort ? `, effort ${host.effort}` : ""}`;
  if (host.name === "cursor" && changed) {
    transcript.info(
      `Model ${label} saved in host-flags.json. Exit and restart the TUI so the Cursor serve host reloads agent.ts with that model. Open sessions keep their original model.`,
    );
  } else if (previousId !== undefined && host.sessionId === undefined) {
    transcript.reset();
    stats = new SessionStats();
    transcript.info(`Model ${label}. The next prompt starts a new session.`);
  } else if (host.name === "claude" && changed && previousId !== undefined) {
    transcript.info(`Model ${label}. This session stays open. /new uses this model.`);
  } else if (host.name !== "cursor" || !changed) {
    transcript.info(`Model ${label}.`);
  }
  render();
}

async function selectModel(): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  const models = await withStatus("Loading models…", () => host.listModels());
  if (models.length === 0) {
    transcript.info(`${host.name} does not report any models.`);
    render();
    return;
  }
  const model = await pick(
    "Model",
    models.map((m) => ({ value: m.id, label: m.label, description: m.id })),
  );
  if (model === undefined) return;
  const efforts = models.find((m) => m.id === model)?.efforts ?? [];
  const effort = efforts.length
    ? await pick("Effort", efforts.map((e) => ({ value: e, label: e })))
    : undefined;
  assignModel(model, effort ?? (efforts.includes(host.effort ?? "") ? host.effort : undefined));
}

async function selectEffort(level: string): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  const models = await withStatus("Loading models…", () => host.listModels());
  const efforts =
    models.find((m) => m.id === host.model)?.efforts ??
    [...new Set(models.flatMap((m) => m.efforts))];
  if (efforts.length === 0) {
    transcript.info(`${host.name} does not report any effort levels.`);
    render();
    return;
  }
  const effort =
    level || (await pick("Effort", efforts.map((e) => ({ value: e, label: e }))));
  if (!effort) return;
  if (!efforts.includes(effort)) {
    transcript.error(`Unknown effort "${effort}". Use one of: ${efforts.join(", ")}.`);
    render();
  } else {
    assignModel(host.model, effort);
  }
}

function clearFollowUpQueue(notice: string): void {
  if (followUpQueue.length === 0) return;
  followUpQueue.clear();
  transcript.info(notice);
  render();
}

function queuedMessage(text: string): { prompt: string; shown: string } {
  return buildQueuedMessage(text, (instructions) =>
    rememberPrompt({
      sessionId: adapter?.sessionId,
      instructions,
      now: new Date(),
    }),
  );
}

function enqueueDuringTurn(text: string): void {
  const item = queuedMessage(text);
  followUpQueue.enqueue(item);
  render();
}

async function dispatchQueued(item: { prompt: string; shown: string }): Promise<void> {
  const command = parseCommand(item.shown);
  if (command) await handleCommand(command.name, command.arg);
  else await runTurn(item.prompt, item.shown);
}

async function injectQueuedIntoTurn(): Promise<void> {
  if (!turn || !adapter?.inject) return;
  const item = followUpQueue.shift();
  if (!item) return;
  transcript.user(item.shown);
  const result = await adapter.inject(item.prompt);
  if (!result.ok) {
    followUpQueue.unshift(item);
    transcript.error(result.message ?? "Could not inject the queued message.");
  }
  render();
}

async function drainFollowUpQueue(): Promise<void> {
  if (drainingFollowUps || turn) return;
  drainingFollowUps = true;
  try {
    while (followUpQueue.length > 0 && !turn) {
      const item = followUpQueue.shift();
      if (!item) break;
      await dispatchQueued(item);
    }
  } finally {
    drainingFollowUps = false;
  }
}

async function runTurn(prompt: string, shown: string): Promise<void> {
  if (!adapter) return;
  const host = adapter;
  transcript.user(shown);
  turn = new AbortController();
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
    transcript.endTurn();
    if (turn.signal.aborted) transcript.info("Stopped.");
    loader.stop();
    status.clear();
    stats.lastTurnMs = Date.now() - started;
    if (!turn.signal.aborted) {
      completedTurns += 1;
      const hostId = asHostId(host.name);
      const retain = loadMemoryExploreSettings(defaultStateRoot(hostId), hostId);
      if (shouldAutoRetain(completedTurns, retain)) {
        followUpQueue.enqueue(queuedMessage("/remember"));
        transcript.info(
          `Queued auto-retain (turn ${completedTurns}, every ${retain.memoryRetainEveryTurns}).`,
        );
      }
    }
    turn = undefined;
    render();
    await drainFollowUpQueue();
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
      if (arg) assignModel(arg, adapter?.effort);
      else await selectModel();
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
    case "flags": {
      const { message } = applyHostFlagsCommand(arg, undefined, adapter?.name);
      transcript.info(message);
      render();
      break;
    }
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
  if (!prompt) {
    if (turn && followUpQueue.length > 0) {
      injectQueuedIntoTurn().catch((error) => {
        transcript.error(errorText(error));
        render();
      });
    }
    return;
  }
  editor.addToHistory(prompt);
  if (turn) {
    enqueueDuringTurn(prompt);
    return;
  }
  const command = parseCommand(prompt);
  const item = queuedMessage(prompt);
  const work = command ? handleCommand(command.name, command.arg) : runTurn(item.prompt, item.shown);
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
