import { platform, Text, token } from "nsh";
import { Tab, Tabs } from "nsh/base";

/**
 * The gallery AI composer's model switch: a row of `Tab`s on a muted track.
 * This `Tabs` has no indicator part, so the selected tab draws its own
 * fill. The fill is `accent`: in this theme `raised` and `muted` are the
 * same color, which would hide the thumb.
 */
export function Segmented<T extends string>(props: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const pointer = platform.desktop;
  const inset = 2;
  const height = pointer ? 26 : 32;
  return (
    <Tabs
      style={{
        height,
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        padding: inset,
        borderRadius: pointer ? 9 : 10,
        borderCurve: "continuous",
        backgroundColor: token("muted"),
        borderWidth: 1,
        borderColor: token("border"),
      }}
    >
      <Each of={props.options}>
        {(option) => {
          const on = props.value === option().value;
          return (
            <Tab
              selected={on}
              onPress={() => {
                if (!on) props.onChange(option().value);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 6,
                borderRadius: pointer ? 6 : 7,
                borderCurve: "continuous",
                backgroundColor: on ? token("accent") : "transparent",
                borderWidth: on ? 1 : 0,
                borderColor: token("border"),
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: pointer ? 12 : 13,
                  fontWeight: "500",
                  color: on ? token("foreground") : token("muted-foreground"),
                }}
              >
                {option().label}
              </Text>
            </Tab>
          );
        }}
      </Each>
    </Tabs>
  );
}
