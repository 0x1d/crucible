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

function blankMarkdown(match) {
  return match.replace(/[^\r\n]/g, " ");
}

function markdownWithoutIgnoredRegions(source) {
  const withoutComments = source.replace(/<!--[\s\S]*?(?:-->|$)/g, blankMarkdown);
  let fence = null;

  return withoutComments.replace(/^.*(?:\r?\n|$)/gm, (line) => {
    if (fence !== null) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*(?:\r?\n)?$/);
      if (
        closing &&
        closing[1][0] === fence.character &&
        closing[1].length >= fence.length
      ) {
        fence = null;
      }
      return blankMarkdown(line);
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = {
        character: opening[1][0],
        length: opening[1].length,
      };
      return blankMarkdown(line);
    }

    return line;
  });
}

function closingBracket(source, opening) {
  let depth = 0;

  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === "[") {
      depth += 1;
    } else if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function skipWhitespace(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function linkClosingParen(source, start) {
  let index = skipWhitespace(source, start);
  if (source[index] === ")") {
    return index;
  }

  const opener = source[index];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== "'" && opener !== '"' && opener !== "(") {
    return -1;
  }

  index += 1;
  for (; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === closer) {
      index = skipWhitespace(source, index + 1);
      return source[index] === ")" ? index : -1;
    }
  }

  return -1;
}

function inlineLinkDestination(source, openingParen) {
  let index = skipWhitespace(source, openingParen + 1);

  if (source[index] === "<") {
    const start = index + 1;
    index = source.indexOf(">", start);
    if (index === -1) {
      return null;
    }
    const end = linkClosingParen(source, index + 1);
    return end === -1 ? null : { end, target: source.slice(start, index) };
  }

  const start = index;
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === "(") {
      depth += 1;
    } else if (source[index] === ")") {
      if (depth === 0) {
        return { end: index, target: source.slice(start, index) };
      }
      depth -= 1;
    } else if (/\s/.test(source[index]) && depth === 0) {
      const end = linkClosingParen(source, index);
      return end === -1 ? null : { end, target: source.slice(start, index) };
    }
  }

  return null;
}

function linkTargets(source) {
  const markdown = markdownWithoutIgnoredRegions(source);
  const targets = [];

  for (let index = 0; index < markdown.length; index += 1) {
    const isImage = markdown[index] === "!" && markdown[index + 1] === "[";
    const opening = isImage ? index + 1 : index;
    if (markdown[opening] !== "[") {
      continue;
    }

    const labelEnd = closingBracket(markdown, opening);
    if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") {
      continue;
    }

    const destination = inlineLinkDestination(markdown, labelEnd + 1);
    if (destination !== null) {
      targets.push({
        isImage,
        line: lineAt(markdown, index),
        target: destination.target,
      });
      index = destination.end;
    }
  }

  const references = /^\s{0,3}\[[^\]]+]:\s*(<[^>\n]+>|[^\s\n]+)/gm;
  for (const match of markdown.matchAll(references)) {
    targets.push({
      isImage: false,
      line: lineAt(markdown, match.index),
      target: match[1],
    });
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
  const linksToIndex = linkTargets(readme).some(({ isImage, target }) => {
    const local = localPath(target);
    return !isImage && local !== null && resolvedTarget("README.md", local) === indexPath;
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
