import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_PLACEHOLDER, cleanForSpeech, SpeechShaper } from "../src/speech/shaper.js";

/** Feeds text in small deltas like a token stream. */
function shape(text: string, step = 3): string[] {
  const s = new SpeechShaper();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) out.push(...s.push(text.slice(i, i + step)));
  out.push(...s.flush());
  return out;
}

test("segments on sentence boundaries", () => {
  assert.deepEqual(shape("Canberra. It was a compromise between Sydney and Melbourne! Odd, really?"), [
    "Canberra.",
    "It was a compromise between Sydney and Melbourne!",
    "Odd, really?",
  ]);
});

test("emits a sentence as soon as it is complete", () => {
  const s = new SpeechShaper();
  assert.deepEqual(s.push("Let me look that up."), []); // end not yet confirmed by whitespace
  assert.deepEqual(s.push(" Tomorrow"), ["Let me look that up."]);
  assert.deepEqual(s.flush(), ["Tomorrow"]);
});

test("first segment is cut early at a clause boundary when the sentence is long", () => {
  const out = shape(
    "Tomorrow in Vienna it will be mostly sunny, with a high of about fourteen degrees and a light breeze from the west. Bring a jacket.",
  );
  assert.deepEqual(out, [
    "Tomorrow in Vienna it will be mostly sunny,",
    "with a high of about fourteen degrees and a light breeze from the west.",
    "Bring a jacket.",
  ]);
});

test("short first sentences are not cut at clauses", () => {
  assert.deepEqual(shape("Well, it is ten past three. Tea time."), ["Well, it is ten past three.", "Tea time."]);
});

test("later segments are not cut at clauses", () => {
  const out = shape("Right. One, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve, thirteen.");
  assert.equal(out.length, 2);
});

test("abbreviations, initials, decimals and list numbers do not end sentences", () => {
  assert.deepEqual(shape("Dr. Smith met J. R. R. Tolkien at 3.5 p.m. on Tuesday. Fine."), [
    "Dr. Smith met J. R. R. Tolkien at 3.5 p.m. on Tuesday.",
    "Fine.",
  ]);
  assert.deepEqual(shape("Steps:\n1. Boil water.\n2. Add tea."), ["Steps:", "Boil water.", "Add tea."]);
});

test("code blocks are replaced by a placeholder, not spoken", () => {
  assert.deepEqual(shape("Here you go.\n```python\nprint('hi. there')\nx = 1\n```\nThat prints hi."), [
    "Here you go.",
    CODE_PLACEHOLDER,
    "That prints hi.",
  ]);
  assert.deepEqual(shape("Sure.\n```js\nlet a = 1;"), ["Sure.", CODE_PLACEHOLDER]);
});

test("markdown, URLs and emoji are stripped", () => {
  assert.equal(cleanForSpeech("## **Bold** and *italic* with `code` 😀"), "Bold and italic with code");
  assert.equal(cleanForSpeech("See [the docs](https://example.com/a/b) or https://www.bbc.co.uk/news?x=1"), "See the docs or bbc.co.uk");
  assert.equal(cleanForSpeech("- first item"), "first item");
  assert.equal(cleanForSpeech("snake_case_name stays"), "snake_case_name stays");
  assert.equal(cleanForSpeech("🎉🎉"), "");
  assert.equal(cleanForSpeech("| a | b |"), "a, b");
});

test("lists split on newlines", () => {
  assert.deepEqual(shape("Three things:\n- tea\n- biscuits\n- rain"), ["Three things:", "tea", "biscuits", "rain"]);
});
