import assert from "node:assert/strict";
import { test } from "node:test";
import { createTheme, resolveTheme, themes } from "./theme.ts";

const ESC = "\u001b[";

test("the registry holds the alchemist theme", () => {
  assert.deepEqual(Object.keys(themes), ["alchemist"]);
});

test("resolveTheme defaults to alchemist", () => {
  assert.equal(resolveTheme(undefined).name, "alchemist");
});

test("resolveTheme rejects an unknown name and lists the available names", () => {
  assert.throws(() => resolveTheme("neon"), /unknown theme "neon".*alchemist/i);
});

test("palette styles wrap the text in color escapes", () => {
  const theme = createTheme("alchemist", themes.alchemist, "truecolor");
  const out = theme.fg.accent("gold");
  assert.ok(out.includes("gold"));
  assert.ok(out.startsWith(ESC));
});

test("the surface style sets a background color and keeps it across inner colors", () => {
  const theme = createTheme("alchemist", themes.alchemist, "truecolor");
  const out = theme.bg.surface(`a ${theme.fg.accent("b")} c`);
  assert.ok(out.startsWith(`${ESC}48;2;`));
  assert.ok(!out.slice(0, -5).includes(`${ESC}49m`));
  assert.ok(!out.includes(`${ESC}0m`));
});

test("pi-tui component themes come from the palette", () => {
  const theme = createTheme("alchemist", themes.alchemist, "truecolor");
  assert.equal(theme.markdown.heading("h"), theme.bold(theme.fg.accent("h")));
  assert.equal(theme.editor.borderColor("-"), theme.fg.border("-"));
  assert.equal(theme.selectList.selectedText("x"), theme.fg.accent("x"));
});

test("contextColor picks the style for the context use ratio", () => {
  const theme = createTheme("alchemist", themes.alchemist, "truecolor");
  assert.equal(theme.contextColor(0.59)("c"), theme.fg.muted("c"));
  assert.equal(theme.contextColor(0.6)("c"), theme.fg.warning("c"));
  assert.equal(theme.contextColor(0.86)("c"), theme.fg.error("c"));
});
