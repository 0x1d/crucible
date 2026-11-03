import {
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
  type TerminalColorMode,
  getTerminalColorMode,
  parseColor,
  styleText,
} from "@earendil-works/pi-tui";

type Style = (text: string) => string;

/** Named color tokens. Values are CSS color strings that `parseColor()` reads. */
export interface Palette {
  accent: string;
  secondary: string;
  muted: string;
  border: string;
  success: string;
  error: string;
  warning: string;
  /** Background of overlays. */
  surface: string;
}

export interface Theme {
  name: string;
  fg: Record<keyof Palette, Style>;
  bg: { surface: Style };
  bold: Style;
  italic: Style;
  /** Style for a context size: success below 150k, warning through 200k, error above. */
  contextColor(tokens: number): Style;
  markdown: MarkdownTheme;
  editor: EditorTheme;
  selectList: SelectListTheme;
}

export const themes = {
  alchemist: {
    accent: "oklch(80% 0.13 85)",
    secondary: "oklch(72% 0.10 190)",
    muted: "oklch(62% 0.01 260)",
    border: "oklch(45% 0.02 260)",
    success: "oklch(72% 0.15 150)",
    error: "oklch(65% 0.18 25)",
    warning: "oklch(78% 0.14 70)",
    surface: "oklch(27% 0.02 260)",
  },
} satisfies Record<string, Palette>;

export function createTheme(
  name: string,
  palette: Palette,
  mode: TerminalColorMode = getTerminalColorMode(),
): Theme {
  const color = (value: string): Style => {
    const fg = parseColor(value);
    return (text) => styleText(text, { fg }, mode);
  };
  const fg = Object.fromEntries(
    Object.entries(palette).map(([token, value]) => [token, color(value)]),
  ) as Record<keyof Palette, Style>;
  const surface = parseColor(palette.surface);
  const bold: Style = (text) => styleText(text, { bold: true }, mode);
  const italic: Style = (text) => styleText(text, { italic: true }, mode);

  const selectList: SelectListTheme = {
    selectedPrefix: fg.accent,
    selectedText: fg.accent,
    description: fg.muted,
    scrollInfo: fg.muted,
    noMatch: fg.muted,
  };

  return {
    name,
    fg,
    bg: { surface: (text) => styleText(text, { bg: surface }, mode) },
    bold,
    italic,
    contextColor: (tokens) =>
      tokens > 200_000 ? fg.error : tokens >= 150_000 ? fg.warning : fg.success,
    markdown: {
      heading: (text) => bold(fg.accent(text)),
      link: fg.secondary,
      linkUrl: fg.muted,
      code: fg.secondary,
      codeBlock: (text) => text,
      codeBlockBorder: fg.border,
      quote: italic,
      quoteBorder: fg.border,
      hr: fg.border,
      listBullet: fg.accent,
      bold,
      italic,
      strikethrough: (text) => styleText(text, { strikethrough: true }, mode),
      underline: (text) => styleText(text, { underline: true }, mode),
    },
    editor: { borderColor: fg.border, selectList },
    selectList,
  };
}

/** Returns the theme with the given name. The default is `alchemist`. */
export function resolveTheme(name: string | undefined): Theme {
  const key = name || "alchemist";
  if (!Object.hasOwn(themes, key)) {
    throw new Error(
      `Unknown theme "${key}". Available themes: ${Object.keys(themes).join(", ")}.`,
    );
  }
  return createTheme(key, themes[key as keyof typeof themes]);
}
