import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const markdownFiles = execFileSync("git", ["ls-files", "-z", "*.md"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const violations = [];

function report(file, line, message) {
  violations.push(`${file}:${line}: ${message}`);
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function linkTargets(source) {
  const targets = [];
  const patterns = [
    /!?\[[^\]]*]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+["'][^"'\n]*["'])?\s*\)/g,
    /^\s*\[[^\]]+]:\s*(<[^>\n]+>|[^\s\n]+)/gm,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      targets.push({
        target: match[1],
        line: lineAt(source, match.index),
      });
    }
  }

  return targets;
}

function localPath(target) {
  let value = target;
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1);
  }

  if (
    value.startsWith("#") ||
    value.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    return null;
  }

  value = value.split("#", 1)[0].split("?", 1)[0];
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolvedTarget(file, target) {
  if (target.startsWith("/")) {
    return path.resolve(root, `.${target}`);
  }
  return path.resolve(root, path.dirname(file), target);
}

const boxDrawing = /[┌┐└┘─│►]/;
const scaffoldMarker = "**TODO: Add description**";
const hexBoilerplate = "If [available in Hex]";

for (const file of markdownFiles) {
  const source = readFileSync(path.join(root, file), "utf8");
  const lines = source.split("\n");
  const internal = file.startsWith("docs/internal/");

  for (const { target, line } of linkTargets(source)) {
    const local = localPath(target);
    if (local !== null && !existsSync(resolvedTarget(file, local))) {
      report(file, line, `missing local link target: ${target}`);
    }
  }

  if (!internal) {
    lines.forEach((line, index) => {
      if (boxDrawing.test(line)) {
        report(file, index + 1, "box-drawing architecture characters are not allowed");
      }
      if (line.includes(scaffoldMarker)) {
        report(file, index + 1, "runtime scaffold description marker is not allowed");
      }
      if (line.includes(hexBoilerplate)) {
        report(file, index + 1, "Hex installation boilerplate is not allowed");
      }
    });
  }
}

const indexPath = path.join(root, "docs/index.md");
if (!existsSync(indexPath)) {
  report("docs/index.md", 1, "required documentation index is missing");
}

const readmePath = path.join(root, "README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const linksToIndex = linkTargets(readme).some(({ target }) => {
    const local = localPath(target);
    return local !== null && resolvedTarget("README.md", local) === indexPath;
  });
  if (!linksToIndex) {
    report("README.md", 1, "missing required link to docs/index.md");
  }
} else {
  report("README.md", 1, "missing required link to docs/index.md");
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}
