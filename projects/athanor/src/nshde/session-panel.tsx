import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { activeAgentPanel, agentPanelId } from "./dock-layout";
import { IconPlus } from "./icons";
import { isPhoneWidth } from "./phone";
import { createAgentSession, dockLayout, focusAgentSession, sessions, type AgentSession } from "./store";

function preview(session: AgentSession): string {
  const last = session.messages[session.messages.length - 1];
  if (!last) return "No messages yet";
  const line = last.content.replace(/\s+/g, " ").trim();
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

function SessionRow(props: { session: AgentSession }) {
  const active = () => activeAgentPanel(dockLayout()) === agentPanelId(props.session.id);
  return (
    <Button
      selected={active()}
      onPress={() => focusAgentSession(props.session.id)}
      accessibilityLabel={`Open ${props.session.title}`}
      class={
        isPhoneWidth()
          ? `min-h-11 justify-center gap-0.5 rounded-md px-2.5 py-2 active:opacity-80 ${active() ? "bg-accent" : "hover:bg-hover"}`
          : `gap-0.5 rounded-md px-2.5 py-2 ${active() ? "bg-accent" : "hover:bg-hover"}`
      }
    >
      <Text numberOfLines={1} class="text-[13px] font-medium text-foreground">
        {props.session.title}
      </Text>
      <Text numberOfLines={1} class="text-[11px] text-faint">
        {preview(props.session)}
      </Text>
    </Button>
  );
}

/** Gallery chat sidebar: a new-session action, then the conversation list. */
export function SessionPanelView() {
  return (
    <View class="flex-1 bg-inset">
      <View class="p-2">
        <Button
          onPress={() => createAgentSession()}
          accessibilityLabel="New agent"
          class={`${isPhoneWidth() ? "h-11" : "h-8"} flex-row items-center gap-2 rounded-md px-2 hover:bg-hover active:opacity-80`}
        >
          <IconPlus />
          <Text class="text-[13px] font-medium text-foreground">New agent</Text>
        </Button>
      </View>
      <Scroll class="min-h-0 flex-1 px-2 pb-2">
        <View class="gap-0.5">
          <Each of={sessions()}>{(session) => <SessionRow session={session()} />}</Each>
        </View>
      </Scroll>
    </View>
  );
}
