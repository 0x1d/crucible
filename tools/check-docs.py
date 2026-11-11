#!/usr/bin/env python3
"""Check documents against the specification framework (docs/framework.md).

Usage:
  tools/check-docs.py                     check the whole workspace
  tools/check-docs.py DIR ID_PREFIX       check one docs folder, e.g. docs crucible/homunculus

Checks: front matter fields, id equals path, relative links resolve,
ids named in depends / related / documents / parent exist, plain ASCII text.
"""
import pathlib
import re
import sys

SKIP_DIRS = {"templates", "guides", "reference", "node_modules"}
REQUIRED = ["id", "title", "type", "owner", "date"]
TREE_CHARS = "├└│─"


def front_matter(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    return m.group(1) if m else None


def field(fm, key):
    m = re.search(rf"^{key}: (.*)$", fm, re.M)
    return m.group(1).strip() if m else None


def check_root(root, prefix, ids, docs, errors):
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if SKIP_DIRS & set(rel.parts) or path.name == "AGENTS.md":
            continue
        text = path.read_text()
        where = str(path)
        if re.search(rf"[^\x00-\x7F{TREE_CHARS}]", text):
            errors.append(f"{where}: text is not plain ASCII")
        for m in re.finditer(r"\]\(([^)\s<>#]+)(#[^)]*)?\)", text):
            target = m.group(1)
            if not re.match(r"https?:|mailto:", target) and not (path.parent / target).exists():
                errors.append(f"{where}: broken link {target}")
        fm = front_matter(text)
        if fm is None:
            errors.append(f"{where}: no front matter")
            continue
        for key in REQUIRED:
            if not field(fm, key):
                errors.append(f"{where}: front matter lacks {key}")
        parts = list(rel.with_suffix("").parts)
        if parts[-1] == "README":
            parts = parts[:-1]
        want = "/".join([prefix] + parts)
        if field(fm, "id") != want:
            errors.append(f"{where}: id is {field(fm, 'id')}, path says {want}")
        ids[field(fm, "id")] = where
        docs.append((where, fm))


def main(argv):
    ids, docs, errors = {}, [], []
    if len(argv) == 3:
        roots = [(pathlib.Path(argv[1]), argv[2])]
        system = argv[2].split("/")[0]
    else:
        ws = pathlib.Path(".")
        manifest = front_matter((ws / "docs" / "README.md").read_text())
        system = field(manifest, "id")
        roots = [(ws / "docs", system)]
        roots += [(p, f"{system}/{p.parent.name}") for p in sorted(ws.glob("projects/*/docs"))]
        roots += [(p, f"{system}/packages/{p.parent.name}") for p in sorted(ws.glob("packages/*/docs"))]
    for root, prefix in roots:
        check_root(root, prefix, ids, docs, errors)
    local = tuple(prefix + "/" for _, prefix in roots) + tuple(prefix for _, prefix in roots)
    for where, fm in docs:
        refs = []
        for m in re.finditer(r"^\s*(?:depends|related|documents|implements): \[(.*)\]$", fm, re.M):
            refs += [r.strip() for r in m.group(1).split(",") if r.strip()]
        if field(fm, "parent"):
            refs.append(field(fm, "parent"))
        for ref in refs:
            is_item = re.search(r"/[A-Z]+-\d+$", ref)
            if ref not in ids and not is_item and ref.startswith(local):
                errors.append(f"{where}: {ref} does not exist")
    for e in errors:
        print(e)
    print(f"{len(ids)} documents checked, {len(errors)} problems")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
