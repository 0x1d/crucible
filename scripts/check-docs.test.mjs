import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-docs.mjs", import.meta.url));

function runChecker(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "check-docs-"));

  try {
    for (const [file, contents] of Object.entries(files)) {
      const destination = path.join(directory, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
    }

    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    execFileSync("git", ["add", "."], { cwd: directory });

    return spawnSync(process.execPath, [checker], {
      cwd: directory,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const validIndex = "# Documentation\n";
const readmeLink = "# Project\n\n[Documentation](docs/index.md)\n";

test("checks local destinations containing balanced parentheses", () => {
  const result = runChecker({
    "README.md": `${readmeLink}\n[Reference](docs/reference_(v2).md)\n`,
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /README\.md:5: missing local link target: docs\/reference_\(v2\)\.md/,
  );
});

test("ignores link-like text in fenced code and HTML comments", () => {
  const result = runChecker({
    "README.md": `${readmeLink}
\`\`\`markdown
[fenced](missing-fenced.md)
\`\`\`

<!-- [commented](missing-comment.md) -->
`,
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("does not count an image as the required README entry link", () => {
  const result = runChecker({
    "README.md": "# Project\n\n![Documentation](docs/index.md)\n",
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:1: missing required link to docs\/index\.md/);
});

test("does not count an unused reference definition as the README entry link", () => {
  const result = runChecker({
    "README.md": "# Project\n\n[documentation]: docs/index.md\n",
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:1: missing required link to docs\/index\.md/);
});

test("does not count an image-only reference use as the README entry link", () => {
  const result = runChecker({
    "README.md": [
      "# Project",
      "",
      "![Documentation][documentation]",
      "",
      "[documentation]: docs/index.md",
      "",
    ].join("\n"),
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:1: missing required link to docs\/index\.md/);
});

test("counts a real reference link as the README entry link", () => {
  const result = runChecker({
    "README.md": [
      "# Project",
      "",
      "[Documentation][documentation]",
      "",
      "[documentation]: docs/index.md",
      "",
    ].join("\n"),
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 0, result.stderr);
});

test("ignores link-like text in single-backtick code spans", () => {
  const result = runChecker({
    "README.md": `${readmeLink}\nUse \`[pseudo](missing-single.md)\` here.\n`,
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("ignores link-like text in multi-backtick code spans", () => {
  const result = runChecker({
    "README.md": `${readmeLink}\nUse \`\`[pseudo](missing-multi.md) with \` code\`\` here.\n`,
    "docs/index.md": validIndex,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("requires lowercase markdown filenames under docs/", () => {
  const result = runChecker({
    "README.md": readmeLink,
    "docs/index.md": validIndex,
    "docs/BAD.md": "# Bad\n",
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/BAD\.md:1: documentation filenames under docs\/ must be lowercase/,
  );
});
