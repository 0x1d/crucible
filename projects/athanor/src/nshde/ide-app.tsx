import { Image, keymap, signal, Text, token, untracked, View, windowSize } from "nsh";
import { Button, DockArea, type DockAreaLayout, type DockAreaRef } from "nsh/base";
import logo from "../../assets/logo.png";
import { AgentPanelView } from "./agent-panel";
import {
  panelsAlongBottom,
  pathFromFilePanel,
  sessionIdFromPanel,
  SESSIONS_PANEL,
  SETTINGS_PANEL,
  TAB_BAR,
  TAB_RAIL,
  runtimeTabBarBox,
  tabShowsClose,
  tabTitle,
} from "./dock-layout";
import { EditorPanelView } from "./editor-panel";
import { IconClose, IconLayout, IconRobot, IconRun, IconTree, TipIconButton, TipTextButton } from "./icons";
import { ObjectTreePanelView } from "./object-tree-panel";
import { RuntimePanelView } from "./runtime-panel";
import { SessionPanelView } from "./session-panel";
import { MobileIde } from "./mobile-ide";
import { isPhoneWidth } from "./phone";
import { SettingsPanelView } from "./settings-panel";
import {
  backend,
  bindDockArea,
  bootError,
  bootIdeData,
  dirty,
  dockLayout,
  dockPanels,
  isFilePanel,
  isPathDirty,
  openSettingsInEditor,
  saveFile,
  selectedPath,
  sessions,
  syncActiveEditorFromLayout,
} from "./store";

/** Gallery resize thumb: quiet hairline, a pill while hovered, solid while dragged. */
const handleThumb =
  "h-11 w-[3px] rounded-full bg-muted-foreground opacity-0 scale-y-0 transition duration-150 ease-out group-hover:opacity-40 group-hover:scale-y-[0.45] group-active:opacity-90 group-active:scale-y-100";

type Edge = "left" | "right" | "bottom";
const RUNTIME_SIZE = 220;
const CHROME_HEIGHT = 36 + 22;

function parseLayoutChange(payload: unknown): DockAreaLayout | null {
  if (payload && typeof payload === "object" && "center" in payload) {
    return payload as DockAreaLayout;
  }
  if (payload && typeof payload === "object" && "layout" in payload) {
    const layout = (payload as { layout: unknown }).layout;
    if (layout && typeof layout === "object" && "center" in layout) return layout as DockAreaLayout;
  }
  return null;
}

function LayoutToggle(props: { edge: Edge; label: string; on: boolean; onPress: (open: boolean) => void }) {
  return (
    <Button
      selected={props.on}
      accessibilityLabel={props.label}
      onPress={() => props.onPress(!props.on)}
      class="size-7 items-center justify-center rounded-md hover:bg-hover selected:bg-hover"
    >
      <IconLayout edge={props.edge} active={props.on} />
    </Button>
  );
}

/**
 * The icon column stays when its dock closes. DockArea will not draw an open
 * dock shorter than 100 points, so the collapsed pane is this rail.
 */
function ActivityRail(props: { edge: "left" | "right"; open: boolean; onPress: (open: boolean) => void }) {
  const label = props.edge === "left" ? "Agents" : "Explorer";
  return (
    <View
      accessibilityLabel={props.edge === "left" ? "Primary side bar" : "Secondary side bar"}
      class={`w-12 items-center bg-inset py-1.5 ${props.edge === "left" ? "border-r border-line" : "border-l border-line"}`}
    >
      <Button
        selected={props.open}
        accessibilityLabel={label}
        onPress={() => props.onPress(!props.open)}
        class="size-10 items-center justify-center rounded-md hover:bg-hover"
      >
        <If when={props.edge === "left"} else={<IconTree active={props.open} />}>
          <IconRobot active={props.open} />
        </If>
      </Button>
    </View>
  );
}

function RuntimeRail(props: { onPress: () => void }) {
  return (
    <View class="h-9 flex-row items-center border-t border-line bg-inset px-1">
      <Button
        onPress={props.onPress}
        accessibilityLabel="Expand runtime"
        class="h-8 flex-row items-center gap-2 rounded-md px-2.5 hover:bg-hover"
      >
        <IconRun />
        <Text class="text-[13px] font-medium text-foreground">Runtime</Text>
      </Button>
    </View>
  );
}

function panelBody(id: string) {
  if (id === "tree") return <ObjectTreePanelView />;
  if (id === SESSIONS_PANEL) return <SessionPanelView />;
  const sessionId = sessionIdFromPanel(id);
  if (sessionId) return <AgentPanelView sessionId={sessionId} />;
  if (id === "runtime") return <RuntimePanelView />;
  if (id === SETTINGS_PANEL) return <SettingsPanelView />;
  const path = pathFromFilePanel(id);
  if (path) return <EditorPanelView path={path} />;
  if (isFilePanel(id)) return null;
  return (
    <View class="flex-1 items-center justify-center">
      <Text class="text-sm text-muted-foreground">Unknown panel</Text>
    </View>
  );
}

function StatusBar() {
  const path = selectedPath();
  const name = path?.split("/").pop();
  return (
    <View class="h-[22px] flex-row items-center gap-2.5 border-t border-line bg-inset px-2.5">
      <Text class="text-[11px] text-muted-foreground">nshde</Text>
      <View class="h-3 w-px bg-line" />
      <Text class="text-[11px] text-faint">{backend()}</Text>
      <View class="flex-1" />
      <If when={dirty()}>
        <Text class="text-[11px]" style={{ color: token("warn") }}>
          Unsaved
        </Text>
      </If>
      <If when={name}>
        <Text class="text-[11px] text-faint">{name}</Text>
      </If>
    </View>
  );
}

export function IdeApp() {
  bootIdeData();
  const phone = () => isPhoneWidth();
  return (
    <If when={phone()} else={<DesktopIde />}>
      <MobileIde />
    </If>
  );
}

function DesktopIde() {
  const layout = dockLayout;
  const width = () => windowSize().width;
  const roomy = () => width() >= 840;
  const showStorage = () => width() >= 1100;
  const initiallyWide = untracked(windowSize).width >= 600;
  const shown = signal<Record<Edge, boolean>>({
    left: initiallyWide,
    right: initiallyWide,
    bottom: initiallyWide,
  });
  let area!: DockAreaRef;
  // A renamed session has to redraw the tab. `titleFor` reads `sessions` too,
  // in case DockArea calls an earlier `renderTab` after the list has changed.
  sessions();

  keymap.bind("mod+s", () => {
    void saveFile();
  });
  keymap.bind("mod+b", () => area.toggleDock("left"));
  keymap.bind("mod+j", () => setPanelVisible("runtime", !panelOpen("runtime")));

  const titleFor = (panel: string) => {
    const sessionId = sessionIdFromPanel(panel);
    if (!sessionId) return tabTitle(panel);
    return sessions().find((session) => session.id === sessionId)?.title ?? "New agent";
  };
  const panelOpen = (id: string) => dockPanels().find((panel) => panel.id === id)?.visible !== false;
  const setPanelVisible = (id: string, open: boolean) => {
    const list = dockPanels();
    dockPanels.set(list.map((panel) => (panel.id === id ? { ...panel, visible: open } : panel)));
  };
  const hiddenPanels = () => new Set(dockPanels().filter((panel) => panel.visible === false).map((panel) => panel.id));
  const runtimeRail = () => !panelOpen("runtime");
  const areaWidth = () => width() - (roomy() ? 96 : 0);
  const areaHeight = () => windowSize().height - CHROME_HEIGHT - (bootError() ? 36 : 0);
  const runtimeTabBar = () =>
    runtimeTabBarBox(layout(), { width: areaWidth(), height: areaHeight() }, hiddenPanels(), {
      left: shown().left,
      right: shown().right,
      bottom: shown().bottom,
    });
  const agentsSpan = () => {
    if (!shown().left) return 0;
    const size = layout().left?.size;
    return typeof size === "number" ? size : 520;
  };
  // A null size on the center split is shared equally. Pin the default
  // columns so Explorer stays 248 wide and Runtime stays 220 tall.
  const center = layout().center;
  if (center.type === "split" && center.axis === "horizontal" && center.children.length === 2) {
    const column = center.children[0];
    const explorer = center.children[1];
    const runtime = column.type === "split" ? column.children[column.children.length - 1] : undefined;
    const explorerSize = center.sizes?.[1];
    const runtimeSize = column.type === "split" ? column.sizes?.[column.sizes.length - 1] : undefined;
    const treeOpen = panelOpen("tree");
    const leftDock = shown().left ? (layout().left?.size ?? 520) : 0;
    const rails = width() >= 840 ? 96 : 0;
    const explorerWidth = treeOpen ? 248 : 0;
    const editorWidth = Math.max(240, windowSize().width - rails - leftDock - explorerWidth);
    const editorHeight = Math.max(240, windowSize().height - CHROME_HEIGHT - RUNTIME_SIZE);
    const defaultExplorer = explorerSize === 248 || explorerSize === 0 || explorerSize == null;
    const defaultRuntime = runtimeSize === RUNTIME_SIZE || runtimeSize == null;
    if (
      column.type === "split" &&
      column.axis === "vertical" &&
      explorer.type === "tabs" &&
      explorer.panels.length === 1 &&
      explorer.panels[0] === "tree" &&
      runtime?.type === "tabs" &&
      runtime.panels.length === 1 &&
      runtime.panels[0] === "runtime" &&
      defaultExplorer &&
      defaultRuntime &&
      (center.sizes?.[0] !== editorWidth ||
        center.sizes?.[1] !== explorerWidth ||
        column.sizes?.[0] !== editorHeight ||
        column.sizes?.[1] !== RUNTIME_SIZE)
    ) {
      layout.set({
        ...layout(),
        center: {
          ...center,
          sizes: [editorWidth, explorerWidth],
          children: [{ ...column, sizes: [editorHeight, RUNTIME_SIZE] }, explorer],
        },
      });
    }
  }
  const explorerSpan = () => {
    const node = layout().center;
    if (!panelOpen("tree") || node.type !== "split" || node.axis !== "horizontal") return 0;
    const edge = node.children[node.children.length - 1];
    if (edge?.type !== "tabs" || !edge.panels.includes("tree")) return 0;
    const size = node.sizes?.[node.sizes.length - 1];
    return typeof size === "number" ? size : 248;
  };

  return (
    <View class="flex-1 bg-background">
      <View accessibilityLabel="Workspace" class="h-9 flex-row items-center gap-1 border-b border-line bg-inset px-2">
        <Image src={logo} class="size-6" accessibilityLabel="nshde logo" />
        <Text class="px-1 text-[13px] font-semibold tracking-tight text-foreground">nshde</Text>
        <View class="flex-1" />
        <If when={showStorage()}>
          <Text class="mr-2 text-[11px] text-faint">Storage {backend()}</Text>
        </If>
        <View accessibilityLabel="Layout" class="flex-row items-center">
          <LayoutToggle edge="left" label="Toggle agents" on={shown().left} onPress={(open) => area.setDockOpen("left", open)} />
          <LayoutToggle edge="bottom" label="Toggle runtime" on={panelOpen("runtime")} onPress={(open) => setPanelVisible("runtime", open)} />
          <LayoutToggle edge="right" label="Toggle explorer" on={panelOpen("tree")} onPress={(open) => setPanelVisible("tree", open)} />
        </View>
        <View class="mx-1 h-4 w-px bg-line" />
        <TipTextButton label="Settings" onPress={() => openSettingsInEditor()}>
          <Text class="text-sm text-muted-foreground">⚙</Text>
        </TipTextButton>
      </View>

      <If when={bootError()}>
        {(err) => (
          <View class="border-b border-destructive/40 bg-destructive/10 px-4 py-2">
            <Text class="text-center text-xs text-destructive">{err()}</Text>
          </View>
        )}
      </If>

      <View class="min-h-0 flex-1 flex-row">
        <If when={roomy()}>
          <ActivityRail edge="left" open={shown().left} onPress={(open) => area.setDockOpen("left", open)} />
        </If>
        <View class="relative min-h-0 min-w-0 flex flex-1 flex-col">
          <DockArea
            ref={(next) => {
              area = next;
              bindDockArea(next);
            }}
            class="min-h-0 min-w-0 flex-1 bg-background"
            layout={layout()}
            onLayoutChange={(payload) => {
              const parsed = parseLayoutChange(payload);
              if (!parsed?.center) return;
              layout.set(parsed);
              syncActiveEditorFromLayout(parsed);
            }}
            onDockOpenChange={(placement, open) => {
              if (placement && typeof placement === "object") {
                const event = placement as { placement?: string; open?: boolean };
                const edge = event.placement;
                if (edge === "left" || edge === "right" || edge === "bottom") {
                  shown.set({ ...shown(), [edge]: !!event.open });
                }
                return;
              }
              if (placement === "left" || placement === "right" || placement === "bottom") {
                shown.set({ ...shown(), [placement]: !!open });
              }
            }}
            panels={dockPanels()}
            groupClass="min-h-0 min-w-0 flex-1 bg-background"
            tabBarClass="flex-row items-end border-b border-line bg-inset"
            tabClass="group"
            contentClass="flex-1 overflow-hidden"
            handleAccessibilityLabel="Resize panel"
            handleClass="basis-px bg-line"
            handleThumbClass={handleThumb}
            dockClass="bg-inset"
            dropIndicatorClass="rounded-md border-2 border-brand bg-brand-tint"
            drawerClass="border-r border-border bg-inset"
            sheetClass="rounded-t-2xl border-t border-border bg-inset"
            backdropClass="bg-black/40"
            renderTab={(tab) => {
              const path = pathFromFilePanel(tab.panel);
              const unsaved = path ? isPathDirty(path) : false;
              const active = tab.active;
              return (
                <View
                  class={`h-[34px] flex-row items-center gap-1.5 border-t-2 px-3 ${
                    active ? "bg-background" : "border-transparent"
                  }`}
                  style={active ? { borderTopColor: unsaved ? token("warn") : token("foreground") } : undefined}
                >
                  <If when={tab.panel === "runtime"}>
                    <IconRun active={active} />
                  </If>
                  <If when={unsaved}>
                    <View class="size-1.5 rounded-full" style={{ backgroundColor: token("warn") }} />
                  </If>
                  <Text
                    numberOfLines={1}
                    class={`max-w-40 text-[13px] ${active ? "" : "text-muted-foreground group-hover:text-foreground"}`}
                    style={unsaved ? { color: token("warn") } : active ? { color: token("foreground") } : undefined}
                  >
                    {titleFor(tab.panel)}
                  </Text>
                  <If when={tabShowsClose(tab.panel)}>
                    <Button
                      onPress={() => area.removePanel(tab.panel)}
                      accessibilityLabel={`Close ${titleFor(tab.panel)}`}
                      class={`size-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70 ${
                        active ? "" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <IconClose />
                    </Button>
                  </If>
                </View>
              );
            }}
            renderDragPreview={(tab) => (
              <View class="rounded-md border border-border bg-raised px-3 py-1.5">
                <Text class="text-[13px] font-medium text-foreground">{titleFor(tab.panel)}</Text>
              </View>
            )}
            renderPanel={(panel) => {
              const body = panelBody(panel.id);
              const covered = runtimeRail() && panelsAlongBottom(layout().center, hiddenPanels()).includes(panel.id);
              if (!covered) return body;
              return (
                <View class="min-h-0 flex-1 flex-col" style={{ paddingBottom: TAB_RAIL }}>
                  {body}
                </View>
              );
            }}
            renderEmpty={() => (
              <View class="flex-1 items-center justify-center gap-1">
                <Text class="text-sm font-semibold text-foreground">No editor tabs open</Text>
                <Text class="text-xs text-muted-foreground">Pick a file from the explorer</Text>
              </View>
            )}
          />
          <If when={!runtimeRail() && runtimeTabBar()}>
            {(bar) => (
              <View
                class="absolute z-20 items-center justify-center bg-inset"
                style={{ top: bar().y, left: bar().x + bar().width - TAB_BAR, width: TAB_BAR, height: TAB_BAR }}
              >
                <TipIconButton label="Collapse runtime" onPress={() => setPanelVisible("runtime", false)}>
                  <IconLayout edge="bottom" active />
                </TipIconButton>
              </View>
            )}
          </If>
          <If when={runtimeRail()}>
            <View
              class="absolute bottom-0 z-10 h-9"
              style={{ left: agentsSpan(), right: explorerSpan() }}
            >
              <RuntimeRail onPress={() => setPanelVisible("runtime", true)} />
            </View>
          </If>
        </View>
        <If when={roomy()}>
          <ActivityRail edge="right" open={panelOpen("tree")} onPress={(open) => setPanelVisible("tree", open)} />
        </If>
      </View>
      <StatusBar />
    </View>
  );
}
