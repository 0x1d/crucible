import type { JSX } from "nsh";
import { Text, token, View } from "nsh";
import { Button, Tooltip } from "nsh/base";
import { isPhoneWidth } from "./phone";

function iconButtonClass(): string {
  const box = isPhoneWidth() ? "size-11" : "size-6";
  return `${box} items-center justify-center rounded-md hover:bg-foreground/10 active:opacity-70 disabled:opacity-40`;
}

function Tip(props: { label: string }) {
  return (
    <Tooltip delay={400}>
      <View class="rounded-md border border-border bg-popover px-2 py-1 shadow-sm">
        <Text class="text-[11px] text-popover-foreground">{props.label}</Text>
      </View>
    </Tooltip>
  );
}

export function IconButton(props: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <View tooltip={<Tip label={props.label} />} class="shrink-0">
      <Button
        onPress={props.onPress}
        disabled={props.disabled}
        selected={props.selected}
        accessibilityLabel={props.label}
        class={`${iconButtonClass()} ${props.selected ? "bg-foreground/15" : ""} ${props.class ?? ""}`}
      >
        {props.children}
      </Button>
    </View>
  );
}

export function IconPlay(props: { tint?: string }) {
  return (
    <View class="size-3 items-center justify-center">
      <Text
        class="text-[10px] leading-none text-muted-foreground"
        style={props.tint ? { color: props.tint } : undefined}
      >
        ▶
      </Text>
    </View>
  );
}

export function IconLive(props: { active?: boolean }) {
  return (
    <View class={`size-2 rounded-full ${props.active ? "bg-up" : "border border-muted-foreground"}`} />
  );
}

export function IconClose() {
  return <Text class="text-[14px] leading-none text-muted-foreground">×</Text>;
}

/** Disclosure chevron. Points right when closed and turns down when open, as in Zed and VS Code. */
export function IconChevron(props: { open?: boolean }) {
  return (
    <Text
      class={`w-3.5 text-center text-[14px] leading-none text-muted-foreground transition-transform ${props.open ? "rotate-90" : ""}`}
    >
      ›
    </Text>
  );
}

/** White while the dock is closed, brand while it is open. Read in each mark so the color follows the open state. */
function railInk(active?: boolean) {
  return active ? token("brand") : token("foreground");
}

/** Activity-bar robot. */
export function IconRobot(props: { active?: boolean }) {
  return (
    <View class="h-4 w-4 items-center justify-end">
      <View class="h-1 w-px" style={{ backgroundColor: railInk(props.active) }} />
      <View
        class="h-[9px] w-[13px] items-center justify-center rounded-[3px] border"
        style={{ borderColor: railInk(props.active) }}
      >
        <View class="flex-row gap-[3px]">
          <View class="size-[3px] rounded-full" style={{ backgroundColor: railInk(props.active) }} />
          <View class="size-[3px] rounded-full" style={{ backgroundColor: railInk(props.active) }} />
        </View>
      </View>
    </View>
  );
}

/** Activity-bar tree: a trunk and two branches. */
export function IconTree(props: { active?: boolean }) {
  return (
    <View class="h-4 w-4 justify-center gap-[3px]">
      <View class="h-1 flex-row items-center gap-0.5">
        <View class="size-1 rounded-[1px]" style={{ backgroundColor: railInk(props.active) }} />
        <View class="h-px min-w-0 flex-1" style={{ backgroundColor: railInk(props.active) }} />
      </View>
      <View class="h-1 flex-row items-center gap-0.5 pl-1.5">
        <View class="size-1 rounded-[1px]" style={{ backgroundColor: railInk(props.active) }} />
        <View class="h-px min-w-0 flex-1" style={{ backgroundColor: railInk(props.active) }} />
      </View>
      <View class="h-1 flex-row items-center gap-0.5 pl-1.5">
        <View class="size-1 rounded-[1px]" style={{ backgroundColor: railInk(props.active) }} />
        <View class="h-px min-w-0 flex-1" style={{ backgroundColor: railInk(props.active) }} />
      </View>
    </View>
  );
}

/** Run mark: a play triangle. The panel-collapse glyph is a separate control. */
export function IconRun(props: { active?: boolean }) {
  const ink = props.active ? token("brand") : token("foreground");
  return (
    <View class="size-4 items-center justify-center">
      <Text class="text-[12px] leading-none" style={{ color: ink }}>
        ▶
      </Text>
    </View>
  );
}

/** Editor mark for the phone bar: a page with three lines. */
export function IconEditor(props: { active?: boolean }) {
  const ink = props.active ? token("brand") : token("foreground");
  return (
    <View class="h-4 w-3.5 justify-center gap-0.5 rounded-[2px] border px-0.5" style={{ borderColor: ink }}>
      <View class="h-px" style={{ backgroundColor: ink }} />
      <View class="h-px w-2" style={{ backgroundColor: ink }} />
      <View class="h-px" style={{ backgroundColor: ink }} />
    </View>
  );
}

/** Layout glyph from the IDE screenshots: a window with one edge filled. Built with flex so the fill stays inside the glyph. */
export function IconLayout(props: { edge: "left" | "right" | "bottom"; active?: boolean }) {
  const stroke = props.active ? "border-foreground" : "border-muted-foreground";
  const fill = props.active ? "bg-foreground" : "bg-muted-foreground";
  if (props.edge === "bottom") {
    return (
      <View class={`h-3.5 w-4 flex-col overflow-hidden rounded-[2px] border ${stroke}`}>
        <View class="min-h-0 flex-1" />
        <View class={`h-[5px] ${fill}`} />
      </View>
    );
  }
  return (
    <View class={`h-3.5 w-4 flex-row overflow-hidden rounded-[2px] border ${stroke}`}>
      <If when={props.edge === "left"}>
        <View class={`w-[5px] self-stretch ${fill}`} />
      </If>
      <View class="min-w-0 flex-1" />
      <If when={props.edge === "right"}>
        <View class={`w-[5px] self-stretch ${fill}`} />
      </If>
    </View>
  );
}

export function IconPlus() {
  return (
    <View class="size-3 items-center justify-center">
      <View class="absolute h-px w-2.5 bg-foreground" />
      <View class="absolute h-2.5 w-px bg-foreground" />
    </View>
  );
}

export function TipIconButton(props: {
  label: string;
  onPress?: () => void;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <View tooltip={<Tip label={props.label} />}>
      <Button
        onPress={props.onPress}
        accessibilityLabel={props.label}
        class={props.class ?? "size-6 items-center justify-center rounded-md hover:bg-hover active:opacity-70"}
      >
        {props.children}
      </Button>
    </View>
  );
}

export function TipTextButton(props: {
  label: string;
  onPress?: () => void;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <View tooltip={<Tip label={props.label} />}>
      <Button
        onPress={props.onPress}
        accessibilityLabel={props.label}
        class={props.class ?? "size-7 items-center justify-center rounded-md hover:bg-hover active:opacity-70"}
      >
        {props.children}
      </Button>
    </View>
  );
}
