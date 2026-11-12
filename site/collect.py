#!/usr/bin/env python3
# crucible/development section 3.2
"""Collect the documentation folders into a Quartz content folder.

Copies docs/, projects/*/docs/ and packages/*/docs/ at their repository
paths, so relative links between documents keep working. A relative link
to a file outside these folders (code, AGENTS.md, a project README) is
rewritten to the file on GitHub. Writes the landing page index.md.

Usage: collect.py <repo-root> <content-dir> <github-blob-base>
"""
import re
import shutil
import sys
from pathlib import Path

LINK = re.compile(r"(\]\()([^)\s<>#]+)((?:#[^)\s]*)?\))")
EXTERNAL = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)


def collect(root, content, blob):
    folders = [root / "docs"]
    folders += sorted(root.glob("projects/*/docs")) + sorted(root.glob("packages/*/docs"))
    folders = [f for f in folders if f.is_dir()]
    if content.exists():
        shutil.rmtree(content)
    for folder in folders:
        shutil.copytree(folder, content / folder.relative_to(root))

    def on_site(path):
        return path.suffix == ".md" and any(path.is_relative_to(f) for f in folders)

    for page in content.rglob("*.md"):
        source = root / page.relative_to(content)

        def rewrite(m):
            target = m.group(2)
            if EXTERNAL.match(target) or target.startswith("/"):
                return m.group(0)
            resolved = (source.parent / target).resolve()
            if not resolved.is_relative_to(root) or on_site(resolved):
                return m.group(0)
            rel = resolved.relative_to(root).as_posix()
            return f"{m.group(1)}{blob}/{rel}{m.group(3)}"

        text = page.read_text()
        page.write_text(LINK.sub(rewrite, text))

    rows = []
    for folder in folders[1:]:
        if (folder / "README.md").is_file():
            name = folder.parent.relative_to(root).as_posix()
            ident = name.removeprefix("projects/")
            rows.append(f"| {folder.parent.name} | [crucible/{ident}]({name}/docs/README.md) |")
    (content / "index.md").write_text(
        "---\ntitle: Crucible documentation\n---\n\n"
        f"Rendered from the [crucible repository]({blob.rsplit('/blob/', 1)[0]}). "
        "Start at the [system manifest](docs/README.md).\n\n"
        "| Project | Documentation |\n| --- | --- |\n" + "\n".join(rows) + "\n"
    )


if __name__ == "__main__":
    root, content, blob = sys.argv[1:4]
    collect(Path(root).resolve(), Path(content).resolve(), blob.rstrip("/"))
