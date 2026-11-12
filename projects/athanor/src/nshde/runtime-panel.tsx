import { Text, View } from "nsh";
import { WebView } from "nsh";
import { previewSrc, runtimePath } from "./store";

export function RuntimePanelView() {
  return (
    <View class="flex-1 bg-inset">
      <If when={runtimePath()} else={<EmptyState />}>
        {() => (
          <WebView
            src={previewSrc()}
            class="min-h-0 flex-1 bg-card"
            style={{ flex: 1 }}
            accessibilityLabel="Runtime module preview"
          />
        )}
      </If>
    </View>
  );
}

function EmptyState() {
  return (
    <View class="flex-1 items-center justify-center gap-2 p-6">
      <Text class="text-sm font-medium text-foreground">Runtime preview</Text>
      <Text class="max-w-xs text-center text-xs text-muted-foreground">
        Mount a module from the object tree or generate one with an agent.
      </Text>
    </View>
  );
}
