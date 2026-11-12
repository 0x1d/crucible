import { effect, Image, Scroll, Text, token, View, type YNode } from "nsh";
import { Button } from "nsh/base";
import logo from "../../assets/logo.png";
import { AgentPanelView } from "./agent-panel";
import {
  activeAgentPanel,
  editorTabs,
  pathFromFilePanel,
  sessionIdFromPanel,
  SETTINGS_PANEL,
  tabShowsClose,
  tabTitle,
} from "./dock-layout";
import { EditorPanelView } from "./editor-panel";
import { IconClose, IconEditor, IconRobot, IconRun, IconTree, TipTextButton } from "./icons";
import { ObjectTreePanelView } from "./object-tree-panel";
import { RuntimePanelView } from "./runtime-panel";
import { SessionPanelView } from "./session-panel";
import { SettingsPanelView } from "./settings-panel";
import {
  backend,
  bootError,
  dirty,
  dismissPanel,
  dockLayout,
  isPathDirty,
  openSettingsInEditor,
  phoneAgentsPage,
  phonePane,
  runtimePath,
  selectEditorTab,
  selectedPath,
  sessions,
  type PhonePane,
} from "./store";

function panelTitle(id: string): string {
  const sessionId = sessionIdFromPanel(id);
  if (!sessionId) return tabTitle(id);
  return sessions().find((session) => session.id === sessionId)?.title ?? "New agent";
}

function PhoneHeader() {
  return (
    <View class="bg-inset pt-[env(safe-area-inset-top)]">
      <View accessibilityLabel="Workspace" class="h-12 flex-row items-center gap-1 border-b border-line px-2">
        <Image src={logo} class="size-6" accessibilityLabel="nshde logo" />
        <Text class="px-1 text-[13px] font-semibold tracking-tight text-foreground">nshde</Text>
        <View class="flex-1" />
        <TipTextButton
          label="Settings"
          onPress={() => openSettingsInEditor()}
          class="size-11 items-center justify-center rounded-md active:opacity-70"
        >
          <Text class="text-sm text-muted-foreground">⚙</Text>
        </TipTextButton>
      </View>
    </View>
  );
}

function PhoneFileTab(props: { id: string }) {
  const active = () => editorTabs(dockLayout()).find((tab) => tab.id === props.id)?.active ?? false;
  const title = () => panelTitle(props.id);
  const unsaved = () => {
    const path = pathFromFilePanel(props.id);
    return path ? isPathDirty(path) : false;
  };
  return (
    <View
      class={`h-11 flex-row items-center border-t-2 ${active() ? "bg-background" : "border-transparent"}`}
      style={active() ? { borderTopColor: unsaved() ? token("warn") : token("foreground") } : undefined}
    >
      <Button
        onPress={() => selectEditorTab(props.id)}
        accessibilityLabel={title()}
        class="h-11 max-w-52 flex-row items-center gap-1.5 px-3 active:opacity-80"
      >
        <If when={unsaved()}>
          <View class="size-1.5 rounded-full" style={{ backgroundColor: token("warn") }} />
        </If>
        <Text
          numberOfLines={1}
          class={`text-[13px] ${active() ? "" : "text-muted-foreground"}`}
          style={unsaved() ? { color: token("warn") } : active() ? { color: token("foreground") } : undefined}
        >
          {title()}
        </Text>
      </Button>
      <If when={tabShowsClose(props.id)}>
        <Button
          onPress={() => dismissPanel(props.id)}
          accessibilityLabel={`Close ${title()}`}
          class="size-11 items-center justify-center active:opacity-70"
        >
          <IconClose />
        </Button>
      </If>
    </View>
  );
}

function PhoneEditorBody(props: { id: string }) {
  if (props.id === SETTINGS_PANEL) return <SettingsPanelView />;
  if (props.id === "runtime") return <RuntimePanelView />;
  if (props.id === "tree") return <ObjectTreePanelView />;
  if (props.id === "sessions") return <SessionPanelView />;
  const sessionId = sessionIdFromPanel(props.id);
  if (sessionId) return <AgentPanelView sessionId={sessionId} />;
  const path = pathFromFilePanel(props.id);
  if (path) return <EditorPanelView path={path} />;
  return null;
}

function PhoneEditor() {
  const ids = () => editorTabs(dockLayout()).map((tab) => tab.id);
  const activeId = () => editorTabs(dockLayout()).find((tab) => tab.active)?.id ?? null;
  let tabScroll: YNode | undefined;
  const showActiveTab = () => {
    const tabs = editorTabs(dockLayout());
    const index = tabs.findIndex((tab) => tab.active);
    if (!tabScroll || index < 0) return;
    const x = index === 0 ? 0 : index === tabs.length - 1 ? 1_000_000 : undefined;
    if (x === undefined) return;
    tabScroll.scrollTo({ x, animated: false });
  };
  effect(() => {
    editorTabs(dockLayout());
    showActiveTab();
    requestAnimationFrame(() => showActiveTab());
  });
  return (
    <View class="min-h-0 flex-1">
      <If when={ids().length > 0}>
        <Scroll
          ref={(node) => {
            tabScroll = node;
            showActiveTab();
          }}
          horizontal
          scrollbar={false}
          class="h-11 border-b border-line bg-inset"
          style={{ flexGrow: 0, flexShrink: 0 }}
        >
          <View class="h-11 flex-row items-end">
            <Each of={ids()}>{(id) => <PhoneFileTab id={id()} />}</Each>
          </View>
        </Scroll>
      </If>
      <Each of={activeId() ? [activeId() as string] : []}>{(id) => <PhoneEditorBody id={id()} />}</Each>
      <If when={!activeId()}>
        <View class="flex-1 items-center justify-center gap-2 px-6">
          <Text class="text-sm font-semibold text-foreground">No editor tabs open</Text>
          <Text class="text-center text-xs text-muted-foreground">Open a file from the Files tab.</Text>
          <Button
            onPress={() => phonePane.set("explorer")}
            accessibilityLabel="Browse files"
            class="mt-1 h-11 items-center justify-center rounded-md px-4 active:opacity-80"
          >
            <Text class="text-[13px] font-medium text-foreground">Browse files</Text>
          </Button>
        </View>
      </If>
    </View>
  );
}

function PhoneSessionList() {
  return (
    <View class="min-h-0 flex-1 bg-inset">
      <View class="h-11 justify-center border-b border-line px-3">
        <Text class="text-[13px] font-medium text-foreground">Sessions</Text>
      </View>
      <SessionPanelView />
    </View>
  );
}

function PhoneChat() {
  const sessionId = () => {
    const panel = activeAgentPanel(dockLayout());
    return panel ? sessionIdFromPanel(panel) ?? "" : "";
  };
  const title = () => sessions().find((session) => session.id === sessionId())?.title ?? "Agent";
  return (
    <If when={sessionId()}>
      {(id) => (
        <View class="min-h-0 flex-1">
          <View class="h-11 flex-row items-center gap-1 border-b border-line bg-inset pr-3">
            <Button
              onPress={() => phoneAgentsPage.set("list")}
              accessibilityLabel="Back to sessions"
              class="h-11 flex-row items-center gap-1 rounded-md px-3 active:opacity-80"
            >
              <Text class="text-[20px] leading-none text-foreground">‹</Text>
              <Text class="text-[13px] font-medium text-foreground">Sessions</Text>
            </Button>
            <Text numberOfLines={1} class="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">
              {title()}
            </Text>
          </View>
          <View class="min-h-0 flex-1 pb-[env(keyboard-inset-height)]">
            <AgentPanelView sessionId={id()} />
          </View>
        </View>
      )}
    </If>
  );
}

function PhoneAgents() {
  const sessionId = () => {
    const panel = activeAgentPanel(dockLayout());
    return panel ? sessionIdFromPanel(panel) : "";
  };
  const showList = () => phoneAgentsPage() === "list" || !sessionId();
  return (
    <If when={showList()} else={<PhoneChat />}>
      <PhoneSessionList />
    </If>
  );
}

function PhoneExplorer() {
  return (
    <View class="min-h-0 flex-1">
      <View class="h-11 justify-center border-b border-line bg-inset px-3">
        <Text class="text-[13px] font-medium text-foreground">Explorer</Text>
      </View>
      <ObjectTreePanelView />
    </View>
  );
}

function PhoneRuntime() {
  const path = () => runtimePath();
  return (
    <View class="min-h-0 flex-1">
      <View class="h-11 flex-row items-center gap-2 border-b border-line bg-inset px-3">
        <Text class="text-[13px] font-medium text-foreground">Runtime</Text>
        <Text numberOfLines={1} class="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {path() ?? "Nothing mounted"}
        </Text>
      </View>
      <View class="min-h-0 flex-1">
        <RuntimePanelView />
      </View>
    </View>
  );
}

function PhoneStatus() {
  const name = () => {
    if (phonePane() === "editor") {
      const id = editorTabs(dockLayout()).find((tab) => tab.active)?.id;
      if (id) return panelTitle(id);
    }
    return selectedPath()?.split("/").pop();
  };
  return (
    <View class="h-[22px] flex-row items-center gap-2 border-t border-line bg-inset px-2.5">
      <Text class="text-[11px] text-muted-foreground">{backend()}</Text>
      <View class="min-w-0 flex-1" />
      <If when={dirty()}>
        <Text class="text-[11px]" style={{ color: token("warn") }}>
          Unsaved
        </Text>
      </If>
      <If when={name()}>
        <Text numberOfLines={1} class="max-w-[50%] text-[11px] text-faint">
          {name()}
        </Text>
      </If>
    </View>
  );
}

const NAV: { id: PhonePane; label: string; title: string }[] = [
  { id: "editor", label: "Show editor", title: "Editor" },
  { id: "agents", label: "Show agents", title: "Agents" },
  { id: "explorer", label: "Show explorer", title: "Files" },
  { id: "runtime", label: "Show runtime", title: "Run" },
];

function NavIcon(props: { id: PhonePane; active: boolean }) {
  if (props.id === "editor") return <IconEditor active={props.active} />;
  if (props.id === "agents") return <IconRobot active={props.active} />;
  if (props.id === "explorer") return <IconTree active={props.active} />;
  return <IconRun active={props.active} />;
}

function PhoneNav() {
  const on = (id: PhonePane) => phonePane() === id;
  return (
    <View accessibilityLabel="Sections" class="flex-row border-t border-line bg-inset pb-[env(safe-area-inset-bottom)]">
      <Each of={NAV}>
        {(item) => (
          <Button
            selected={on(item().id)}
            accessibilityLabel={item().label}
            onPress={() => openSection(item().id)}
            class={`min-h-11 flex-1 items-center justify-center gap-0.5 py-1 active:opacity-80 ${on(item().id) ? "bg-hover" : ""}`}
          >
            <NavIcon id={item().id} active={on(item().id)} />
            <Text class={`text-[11px] font-medium ${on(item().id) ? "text-brand" : "text-muted-foreground"}`}>
              {item().title}
            </Text>
          </Button>
        )}
      </Each>
    </View>
  );
}

function openSection(id: PhonePane) {
  if (id === "agents" && phonePane() === "agents") {
    phoneAgentsPage.set("list");
    return;
  }
  phonePane.set(id);
}

function PhoneBody() {
  const pane = () => phonePane();
  return (
    <View class="min-h-0 flex-1">
      <If when={pane() === "editor"}>
        <PhoneEditor />
      </If>
      <If when={pane() === "agents"}>
        <PhoneAgents />
      </If>
      <If when={pane() === "explorer"}>
        <PhoneExplorer />
      </If>
      <If when={pane() === "runtime"}>
        <PhoneRuntime />
      </If>
    </View>
  );
}

/** Full-screen sections. Side panes never slide over the page, so each one can be left from the bottom bar. */
export function MobileIde() {
  return (
    <View class="flex-1 bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <PhoneHeader />
      <If when={bootError()}>
        {(err) => (
          <View class="border-b border-destructive/40 bg-destructive/10 px-4 py-2">
            <Text class="text-center text-xs text-destructive">{err()}</Text>
          </View>
        )}
      </If>
      <View class="min-h-0 flex-1 overflow-hidden">
        <PhoneBody />
      </View>
      <PhoneStatus />
      <PhoneNav />
    </View>
  );
}
