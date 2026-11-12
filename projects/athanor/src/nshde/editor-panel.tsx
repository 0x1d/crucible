import { Text, token, untracked, View } from "nsh";
import { Button, Editor } from "nsh/base";
import { isPhoneWidth } from "./phone";
import {
  editorCache,
  editorEpoch,
  isPathDirty,
  languageForPath,
  onEditorValueChange,
  saveFile,
} from "./store";

export function EditorPanelView(props: { path: string }) {
  const unsaved = () => isPathDirty(props.path);
  const binary = () => props.path.endsWith(".wasm");

  return (
    <View class="flex-1 bg-background">
      <View
        accessibilityLabel={isPhoneWidth() ? "Editor path" : "Editor"}
        class={`${isPhoneWidth() ? "h-11" : "h-8"} flex-row items-center gap-2 border-b border-line bg-inset px-3`}
      >
        <Text numberOfLines={1} class="min-w-0 flex-1 font-mono text-[12px] text-muted-foreground">
          {props.path}
        </Text>
        <Button
          onPress={() => void saveFile(props.path)}
          disabled={binary() || !unsaved()}
          accessibilityLabel="Save file"
          class={`${isPhoneWidth() ? "h-11 px-3" : "h-6 px-1.5"} flex-row items-center rounded-md hover:bg-hover active:opacity-70 disabled:opacity-40`}
        >
          <Text
            class={`text-[12px] font-medium ${unsaved() ? "" : "text-faint"}`}
            style={unsaved() ? { color: token("warn") } : undefined}
          >
            Save
          </Text>
        </Button>
      </View>
      <EditorBody path={props.path} />
    </View>
  );
}

function EditorBody(props: { path: string }) {
  return (
    <View class="flex-1 bg-background">
      {() => {
        const epoch = editorEpoch()[props.path] ?? 0;
        if (epoch === 0) {
          return (
            <View class="flex-1 items-center justify-center">
              <Text class="text-xs text-muted-foreground">Loading file…</Text>
            </View>
          );
        }
        const value = untracked(() => editorCache()[props.path]?.value ?? "");
        return (
          <Editor
            defaultValue={value}
            language={languageForPath(props.path)}
            lineNumbers
            softWrap={isPhoneWidth()}
            readOnly={props.path.endsWith(".wasm")}
            onChange={(next) => {
              if (typeof next !== "string") return;
              onEditorValueChange(props.path, next);
            }}
            accessibilityLabel={props.path}
            class="flex-1 font-mono text-[13px]"
          />
        );
      }}
    </View>
  );
}
