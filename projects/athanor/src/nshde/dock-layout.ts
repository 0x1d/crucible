import type { DockAreaLayout } from "nsh/base";

export const FILE_PREFIX = "file:";
export const SETTINGS_PANEL = "settings";
export const SESSIONS_PANEL = "sessions";
export const AGENT_PREFIX = "agent:";
export const DEFAULT_SESSION_ID = "main";

const DOCK_TITLES: Record<string, string> = {
  tree: "Explorer",
  runtime: "Runtime",
  [SESSIONS_PANEL]: "Sessions",
  [SETTINGS_PANEL]: "Settings",
};

/** Gallery dock tab height (`h-9`). An open DockArea dock cannot be shorter than 100 points. */
export const TAB_RAIL = 36;
/** Open tab row. Tabs are `h-[34px]` with the border inside the box. */
export const TAB_BAR = 34;
/** Split and dock handles (`basis-px`). */
const SPLIT_HANDLE = 1;

type DockNode = DockAreaLayout["center"];
type DockPlacement = "left" | "right" | "bottom";

function walkPanels(node: DockNode, visit: (id: string) => void) {
  if (node.type === "tabs") {
    for (const id of node.panels) visit(id);
    return;
  }
  for (const child of node.children) walkPanels(child, visit);
}

/** Panels on the bottom edge of a layout node. A vertical split only counts its lowest visible child; a horizontal split counts every column. */
export function panelsAlongBottom(node: DockNode | undefined, hidden: ReadonlySet<string> = new Set()): string[] {
  if (!node) return [];
  if (node.type === "tabs") return node.panels.filter((id) => !hidden.has(id));
  if (node.axis === "vertical") {
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const ids = panelsAlongBottom(node.children[index], hidden);
      if (ids.length) return ids;
    }
    return [];
  }
  return node.children.flatMap((child) => panelsAlongBottom(child, hidden));
}

/** Whether a dock still holds `id` (a closed dock keeps its panels). */
export function dockHasPanel(layout: DockAreaLayout | undefined, placement: DockPlacement, id: string): boolean {
  const region = layout?.[placement];
  if (!region) return false;
  let found = false;
  walkPanels(region.layout, (panel) => {
    if (panel === id) found = true;
  });
  return found;
}

export function filePanelId(path: string): string {
  return `${FILE_PREFIX}${path}`;
}

export function pathFromFilePanel(id: string): string | null {
  return id.startsWith(FILE_PREFIX) ? id.slice(FILE_PREFIX.length) : null;
}

export function agentPanelId(sessionId: string): string {
  return `${AGENT_PREFIX}${sessionId}`;
}

export function sessionIdFromPanel(id: string): string | null {
  return id.startsWith(AGENT_PREFIX) ? id.slice(AGENT_PREFIX.length) : null;
}

export function tabTitle(panelId: string): string {
  const path = pathFromFilePanel(panelId);
  if (path) return path.split("/").pop() ?? path;
  return DOCK_TITLES[panelId] ?? panelId;
}

function sessionsGroup(): DockNode {
  return { type: "tabs", panels: [SESSIONS_PANEL], activeIndex: 0 };
}

function conversationGroup(panelId: string): DockNode {
  return { type: "tabs", panels: [panelId], activeIndex: 0 };
}

/** The panel shown in the agent conversation tabs, if that group is still in the left dock. */
export function activeAgentPanel(layout: DockAreaLayout | undefined): string | null {
  const node = layout?.left?.layout;
  if (!node) return null;
  let found: string | null = null;
  const walk = (current: DockNode) => {
    if (current.type === "tabs") {
      const panel = current.panels[current.activeIndex ?? 0];
      if (panel && sessionIdFromPanel(panel)) found = panel;
      return;
    }
    for (const child of current.children) walk(child);
  };
  walk(node);
  return found;
}

function isSessionsGroup(node: DockNode): boolean {
  return node.type === "tabs" && node.panels.includes(SESSIONS_PANEL) && !node.panels.some((id) => sessionIdFromPanel(id));
}

/** Puts `panelId` in the conversation tab group and shows it. Rebuilds the split if that group was closed away. */
export function openAgentTab(layout: DockAreaLayout, panelId: string): DockAreaLayout {
  const region = layout.left ?? { layout: sessionsGroup(), size: 520, open: true };
  const next = placeAgentPanel(region.layout, panelId);
  return {
    ...layout,
    left: { ...region, layout: next, open: true, size: region.size ?? 520 },
  };
}

function placeAgentPanel(node: DockNode, panelId: string): DockNode {
  if (node.type === "tabs") {
    if (isSessionsGroup(node)) {
      return {
        type: "split",
        axis: "horizontal",
        children: [node, conversationGroup(panelId)],
        sizes: [200, null],
      } as DockNode;
    }
    const panels = node.panels.includes(panelId) ? node.panels : [...node.panels, panelId];
    return { ...node, panels, activeIndex: panels.indexOf(panelId) };
  }

  let placed = false;
  const children = node.children.map((child) => {
    if (placed || isSessionsGroup(child)) return child;
    placed = true;
    return placeAgentPanel(child, panelId);
  });
  if (placed) return { ...node, children } as DockNode;
  return {
    ...node,
    children: [...node.children, conversationGroup(panelId)],
  } as DockNode;
}

export function initialIdeLayout(welcomePath: string): DockAreaLayout {
  return {
    // Explorer and Runtime each have a group beside them, so those tabs can
    // leave the way Sessions can. A group that is the only child of a dock cannot.
    center: {
      type: "split",
      axis: "horizontal",
      sizes: [800, 248],
      children: [
        {
          type: "split",
          axis: "vertical",
          sizes: [800, 220],
          children: [
            { type: "tabs", panels: [filePanelId(welcomePath)], activeIndex: 0 },
            { type: "tabs", panels: ["runtime"], activeIndex: 0 },
          ],
        },
        { type: "tabs", panels: ["tree"], activeIndex: 0 },
      ],
    },
    left: {
      layout: {
        type: "split",
        axis: "horizontal",
        children: [sessionsGroup(), conversationGroup(agentPanelId(DEFAULT_SESSION_ID))],
        sizes: [200, null],
      },
      size: 520,
      open: true,
    },
  };
}

type TabGroup = Extract<DockNode, { type: "tabs" }>;

function isToolGroup(node: TabGroup): boolean {
  return node.panels.length > 0 && node.panels.every((id) => id === "runtime" || id === "tree");
}

function centerEditorTabs(center: DockNode): TabGroup | null {
  if (center.type === "tabs") return isToolGroup(center) ? null : center;
  for (const child of center.children) {
    const found = centerEditorTabs(child);
    if (found) return found;
  }
  return null;
}

function updateEditorGroup(node: DockNode, update: (group: TabGroup) => TabGroup): DockNode {
  if (node.type === "tabs") return isToolGroup(node) ? node : update(node);
  let done = false;
  const children = node.children.map((child) => {
    if (done) return child;
    const next = updateEditorGroup(child, update);
    if (next !== child) done = true;
    return next;
  });
  return done ? ({ ...node, children } as DockNode) : node;
}

export function collectCenterPanelIds(layout: DockAreaLayout | undefined): string[] {
  if (!layout?.center) return [];
  const ids = new Set<string>();
  const walk = (node: DockAreaLayout["center"]) => {
    if (node.type === "tabs") {
      for (const id of node.panels) ids.add(id);
      return;
    }
    if (node.type === "split") {
      for (const child of node.children) walk(child as DockAreaLayout["center"]);
    }
  };
  walk(layout.center);
  return [...ids];
}

/** File and settings tabs in the editor group, in order. Tool groups are not included. */
export function editorTabs(layout: DockAreaLayout | undefined): { id: string; active: boolean }[] {
  if (!layout) return [];
  const group = centerEditorTabs(layout.center);
  if (!group) return [];
  const activeIndex = group.activeIndex ?? 0;
  return group.panels.map((id, index) => ({ id, active: index === activeIndex }));
}

function insertEditorGroup(center: DockNode, panelId: string): DockNode {
  const group: TabGroup = { type: "tabs", panels: [panelId], activeIndex: 0 };
  if (center.type === "split" && center.axis === "horizontal" && center.children.length > 0) {
    const first = center.children[0];
    const column: DockNode =
      first.type === "split" && first.axis === "vertical"
        ? {
            ...first,
            children: [group, ...first.children],
            sizes: [null, ...(first.sizes ?? first.children.map(() => null))],
          }
        : { type: "split", axis: "vertical", sizes: [null, null], children: [group, first] };
    return { ...center, children: [column, ...center.children.slice(1)] };
  }
  return { type: "split", axis: "vertical", sizes: [null, null], children: [group, center] };
}

export function addCenterTab(layout: DockAreaLayout, panelId: string): DockAreaLayout {
  if (!centerEditorTabs(layout.center)) {
    return { ...layout, center: insertEditorGroup(layout.center, panelId) };
  }
  const center = updateEditorGroup(layout.center, (group) => {
    const panels = group.panels.includes(panelId) ? group.panels : [...group.panels, panelId];
    return { ...group, panels, activeIndex: panels.indexOf(panelId) };
  });
  return { ...layout, center };
}

function removeFromNode(node: DockNode, id: string): DockNode | null {
  if (node.type === "tabs") {
    const index = node.panels.indexOf(id);
    if (index < 0) return node;
    const panels = node.panels.filter((panel) => panel !== id);
    if (panels.length === 0) return null;
    let active = node.activeIndex ?? 0;
    if (index < active) active -= 1;
    if (active >= panels.length) active = panels.length - 1;
    return { ...node, panels, activeIndex: active };
  }
  let changed = false;
  const children: DockNode[] = [];
  const sizes: Array<number | null> = [];
  node.children.forEach((child, childIndex) => {
    const next = removeFromNode(child, id);
    if (next !== child) changed = true;
    if (!next) return;
    children.push(next);
    sizes.push(node.sizes?.[childIndex] ?? null);
  });
  if (!changed) return node;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes };
}

function activateInNode(node: DockNode, id: string): DockNode {
  if (node.type === "tabs") {
    const index = node.panels.indexOf(id);
    if (index < 0 || index === (node.activeIndex ?? 0)) return node;
    return { ...node, activeIndex: index };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = activateInNode(child, id);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? ({ ...node, children } as DockNode) : node;
}

function mapDock(region: DockAreaLayout["left"], visit: (node: DockNode) => DockNode | null) {
  if (!region) return region;
  const next = visit(region.layout);
  if (next === region.layout) return region;
  return { ...region, layout: next ?? { type: "tabs" as const, panels: [], activeIndex: 0 } };
}

/** Drops a panel and collapses a split that would be left with one child. */
export function removePanelFromLayout(layout: DockAreaLayout, id: string): DockAreaLayout {
  return {
    ...layout,
    center: removeFromNode(layout.center, id) ?? { type: "tabs", panels: [], activeIndex: 0 },
    left: mapDock(layout.left, (node) => removeFromNode(node, id)),
    right: mapDock(layout.right, (node) => removeFromNode(node, id)),
    bottom: mapDock(layout.bottom, (node) => removeFromNode(node, id)),
  };
}

/** Shows `id` in whichever group already holds it. */
export function activatePanel(layout: DockAreaLayout, id: string): DockAreaLayout {
  return {
    ...layout,
    center: activateInNode(layout.center, id),
    left: layout.left ? { ...layout.left, layout: activateInNode(layout.left.layout, id) } : layout.left,
    right: layout.right ? { ...layout.right, layout: activateInNode(layout.right.layout, id) } : layout.right,
    bottom: layout.bottom ? { ...layout.bottom, layout: activateInNode(layout.bottom.layout, id) } : layout.bottom,
  };
}

export function addFileTab(layout: DockAreaLayout, path: string): DockAreaLayout {
  return addCenterTab(layout, filePanelId(path));
}

export function openSettingsTab(layout: DockAreaLayout): DockAreaLayout {
  return addCenterTab(layout, SETTINGS_PANEL);
}

/** A close button. Tool panes stay open so they can still be dragged to another group. */
export function tabShowsClose(id: string): boolean {
  return id === SETTINGS_PANEL || sessionIdFromPanel(id) !== null || pathFromFilePanel(id) !== null;
}

/** Every pane can leave its group. DockArea only drags a panel whose options say it is closable. */
export function panelClosable(_id: string): boolean {
  return true;
}

export function defaultDockPanels(welcomePath: string): { id: string; closable: boolean; visible?: boolean }[] {
  return [
    { id: "tree", closable: true },
    { id: "runtime", closable: true },
    { id: SESSIONS_PANEL, closable: true },
    { id: agentPanelId(DEFAULT_SESSION_ID), closable: true },
    { id: filePanelId(welcomePath), closable: true },
  ];
}

export interface TabBarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function splitLengths(sizes: Array<number | null> | undefined, count: number, total: number): number[] {
  const gaps = Math.max(0, count - 1) * SPLIT_HANDLE;
  const available = Math.max(0, total - gaps);
  const spec: Array<number | null> = [];
  for (let index = 0; index < count; index += 1) spec.push(sizes?.[index] ?? null);
  let fixed = 0;
  let flex = 0;
  for (const size of spec) {
    if (typeof size === "number") fixed += size;
    else flex += 1;
  }
  if (flex === 0 && fixed > 0 && fixed !== available) {
    const scale = available / fixed;
    return spec.map((size) => (size ?? 0) * scale);
  }
  const share = flex > 0 ? Math.max(0, (available - fixed) / flex) : 0;
  return spec.map((size) => (typeof size === "number" ? size : share));
}

function findRuntimeTab(node: DockNode, box: TabBarBox, hidden: ReadonlySet<string>): TabBarBox | null {
  if (node.type === "tabs") {
    if (!node.panels.includes("runtime") || hidden.has("runtime")) return null;
    return { x: box.x, y: box.y, width: box.width, height: TAB_BAR };
  }
  const count = node.children.length;
  const along = node.axis === "horizontal" ? box.width : box.height;
  const sizes = splitLengths(node.sizes, count, along);
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const child = node.children[index];
    if (!child) continue;
    const length = sizes[index] ?? 0;
    const childBox: TabBarBox =
      node.axis === "horizontal"
        ? { x: box.x + offset, y: box.y, width: length, height: box.height }
        : { x: box.x, y: box.y + offset, width: box.width, height: length };
    const found = findRuntimeTab(child, childBox, hidden);
    if (found) return found;
    offset += length + SPLIT_HANDLE;
  }
  return null;
}

/**
 * The runtime group's tab row, in DockArea coordinates. Hidden runtime has no row.
 * `docks` is which edges are open; a missing region takes no room.
 */
export function runtimeTabBarBox(
  layout: DockAreaLayout,
  area: { width: number; height: number },
  hidden: ReadonlySet<string>,
  docks: { left: boolean; right: boolean; bottom: boolean },
): TabBarBox | null {
  let center: TabBarBox = { x: 0, y: 0, width: area.width, height: area.height };
  const regions: Array<{ edge: "left" | "right" | "bottom"; open: boolean }> = [
    { edge: "left", open: docks.left },
    { edge: "right", open: docks.right },
    { edge: "bottom", open: docks.bottom },
  ];
  for (const { edge, open } of regions) {
    const region = layout[edge];
    if (!region || !open) continue;
    const size = typeof region.size === "number" ? region.size : 200;
    if (edge === "left") {
      const found = findRuntimeTab(region.layout, { x: 0, y: 0, width: size, height: area.height }, hidden);
      if (found) return found;
      center = {
        x: center.x + size + SPLIT_HANDLE,
        y: center.y,
        width: Math.max(0, center.width - size - SPLIT_HANDLE),
        height: center.height,
      };
    } else if (edge === "right") {
      const found = findRuntimeTab(
        region.layout,
        { x: area.width - size, y: 0, width: size, height: area.height },
        hidden,
      );
      if (found) return found;
      center = { ...center, width: Math.max(0, center.width - size - SPLIT_HANDLE) };
    } else {
      const found = findRuntimeTab(
        region.layout,
        { x: center.x, y: area.height - size, width: center.width, height: size },
        hidden,
      );
      if (found) return found;
      center = { ...center, height: Math.max(0, center.height - size - SPLIT_HANDLE) };
    }
  }
  return findRuntimeTab(layout.center, center, hidden);
}

export function activeFilePath(layout: DockAreaLayout | undefined): string | null {
  if (!layout?.center) return null;
  const group = centerEditorTabs(layout.center);
  if (!group) return null;
  const panel = group.panels[group.activeIndex ?? 0];
  return pathFromFilePanel(panel ?? "");
}
