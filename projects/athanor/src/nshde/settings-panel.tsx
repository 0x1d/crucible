import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { StorageBackend } from "../lib/storage/types";
import { isPhoneWidth } from "./phone";
import { backend, changeBackend } from "./store";

export function SettingsPanelView() {
  return (
    <Scroll class="flex-1 bg-card">
      <View class="mx-auto w-full max-w-lg gap-4 p-6">
        <View class="gap-1">
          <Text class="text-lg font-semibold text-foreground">Settings</Text>
          <Text class="text-sm text-muted-foreground">Workspace and storage configuration.</Text>
        </View>
        <View class="gap-2 rounded-lg border border-line bg-inset p-4">
          <Text class="text-sm font-medium text-foreground">File storage backend</Text>
          <Text class="text-xs text-muted-foreground">Where module files are persisted on the server.</Text>
          <View class="flex-row flex-wrap gap-2 pt-2">
            <Each of={["fs", "memory", "s3"] as StorageBackend[]}>
              {(b) => (
                <Button
                  onPress={() => void changeBackend(b())}
                  selected={backend() === b()}
                  class={
                    isPhoneWidth()
                      ? "h-11 rounded-md px-3 py-1.5 text-sm font-medium selected:bg-primary selected:text-primary-foreground hover:bg-hover"
                      : "rounded-md px-3 py-1.5 text-sm font-medium selected:bg-primary selected:text-primary-foreground hover:bg-hover"
                  }
                >
                  <Text class={backend() === b() ? "text-primary-foreground" : "text-foreground"}>{b()}</Text>
                </Button>
              )}
            </Each>
          </View>
        </View>
      </View>
    </Scroll>
  );
}
