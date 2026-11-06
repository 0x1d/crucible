#!/usr/bin/env python3
"""Add @type args and @spec run(args()) to every codex tool.ex."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "functions"

ANY = "  @type args :: %{optional(String.t()) => term()}"

# slug -> {field: (required?, type)}
FIELDS: dict[str, dict[str, tuple[bool, str]]] = {
    "echo": {},
    "debug.echo_args": {},
    "pipeline.demo": {},
    "runtime.bounce_memory": {},
    "codex.docs": {
        "query": (False, "String.t()"),
        "title": (False, "String.t()"),
    },
    "codex.patch": {
        "slug": (True, "String.t()"),
        "name": (False, "String.t()"),
        "edits": (True, "[map()]"),
        "dry_run": (False, "boolean()"),
    },
    "codex.uncommitted_report": {
        "repo": (False, "String.t()"),
        "functions_rel": (False, "String.t()"),
        "load_missing": (False, "boolean()"),
        "journal": (False, "String.t()"),
    },
    "codex.commit_uncommitted": {
        "dry_run": (False, "boolean()"),
        "slugs": (False, "[String.t()]"),
        "repo": (False, "String.t()"),
        "functions_rel": (False, "String.t()"),
        "load_missing": (False, "boolean()"),
        "journal": (False, "String.t()"),
    },
    "data.filter": {
        "data": (False, "[map()]"),
        "entries": (False, "[map()]"),
        "rows": (False, "[map()]"),
        "items": (False, "[map()]"),
        "field": (False, "String.t()"),
        "op": (False, "String.t()"),
        "value": (False, "term()"),
        "filters": (False, "[map()]"),
        "key": (False, "String.t()"),
    },
    "data.select": {
        "data": (False, "[map()]"),
        "entries": (False, "[map()]"),
        "rows": (False, "[map()]"),
        "items": (False, "[map()]"),
        "columns": (False, "[String.t()]"),
        "keys": (False, "[String.t()]"),
        "key": (False, "String.t()"),
        "rename": (False, "map()"),
    },
    "data.sort": {
        "data": (False, "[map()]"),
        "entries": (False, "[map()]"),
        "rows": (False, "[map()]"),
        "items": (False, "[map()]"),
        "by": (False, "String.t()"),
        "field": (False, "String.t()"),
        "order": (False, "String.t()"),
        "key": (False, "String.t()"),
    },
    "demo.report": {
        "title": (False, "String.t()"),
        "columns": (False, "[String.t()]"),
        "field": (False, "String.t()"),
        "op": (False, "String.t()"),
        "value": (False, "term()"),
        "by": (False, "String.t()"),
        "order": (False, "String.t()"),
    },
    "docker.overview": {"all": (False, "boolean()")},
    "docker.ps": {"all": (False, "boolean()")},
    "docker.ps_report": {"all": (False, "boolean()")},
    "env.get": {
        "name": (False, "String.t()"),
        "names": (False, "[String.t()]"),
    },
    "fs.glob": {
        "path": (False, "String.t()"),
        "root": (False, "String.t()"),
        "pattern": (True, "String.t()"),
    },
    "fs.list": {"path": (True, "String.t()")},
    "fs.list_md": {
        "path": (True, "String.t()"),
        "columns": (False, "[String.t()]"),
        "key": (False, "String.t()"),
    },
    "fs.patch": {
        "path": (True, "String.t()"),
        "edits": (True, "[map()]"),
        "dry_run": (False, "boolean()"),
    },
    "fs.read": {
        "path": (True, "String.t()"),
        "max_bytes": (False, "non_neg_integer()"),
    },
    "fs.rg": {
        "pattern": (True, "String.t()"),
        "path": (False, "String.t()"),
        "root": (False, "String.t()"),
        "glob": (False, "String.t()"),
        "ignore_case": (False, "boolean()"),
        "fixed_strings": (False, "boolean()"),
        "follow_symlinks": (False, "boolean()"),
        "max_matches": (False, "non_neg_integer()"),
        "timeout_ms": (False, "non_neg_integer()"),
    },
    "fs.stat": {"path": (True, "String.t()")},
    "fs.tree": {
        "path": (True, "String.t()"),
        "max_depth": (False, "non_neg_integer()"),
        "ignore": (False, "[String.t()]"),
    },
    "fs.write": {
        "path": (True, "String.t()"),
        "content": (True, "String.t()"),
        "append": (False, "boolean()"),
        "overwrite": (False, "boolean()"),
    },
    "git.commit": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "dry_run": (False, "boolean()"),
        "push": (False, "boolean()"),
        "remote": (False, "String.t()"),
        "allow_conflict_markers": (False, "boolean()"),
    },
    "git.diff": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "ref": (False, "String.t()"),
        "to": (False, "String.t()"),
        "paths": (False, "[String.t()]"),
        "staged": (False, "boolean()"),
        "stat_only": (False, "boolean()"),
    },
    "git.log": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "ref": (False, "String.t()"),
        "limit": (False, "non_neg_integer()"),
        "since": (False, "String.t()"),
        "until": (False, "String.t()"),
        "author": (False, "String.t()"),
        "paths": (False, "[String.t()]"),
        "no_merges": (False, "boolean()"),
        "first_parent": (False, "boolean()"),
    },
    "git.log_report": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "since": (False, "String.t()"),
        "limit": (False, "non_neg_integer()"),
        "top_files": (False, "non_neg_integer()"),
    },
    "git.status": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "paths": (False, "[String.t()]"),
        "untracked": (False, "String.t()"),
        "ignored": (False, "boolean()"),
    },
    "github.create_pr": {
        "cwd": (False, "String.t()"),
        "repo": (False, "String.t()"),
        "base": (False, "String.t()"),
        "head": (False, "String.t()"),
        "title": (False, "String.t()"),
        "body": (False, "String.t()"),
        "draft": (False, "boolean()"),
        "dry_run": (False, "boolean()"),
        "timeout_ms": (False, "non_neg_integer()"),
    },
    "github.repo_files": {
        "repo": (True, "String.t()"),
        "ref": (False, "String.t()"),
        "contains": (False, "String.t()"),
        "ext": (False, "[String.t()]"),
        "limit": (False, "non_neg_integer()"),
    },
    "http.get": {
        "url": (True, "String.t()"),
        "headers": (False, "map()"),
        "max_bytes": (False, "non_neg_integer()"),
        "timeout_ms": (False, "non_neg_integer()"),
    },
    "http.grep": {
        "url": (True, "String.t()"),
        "pattern": (True, "String.t()"),
        "ignore_case": (False, "boolean()"),
        "max_matches": (False, "non_neg_integer()"),
        "context": (False, "non_neg_integer()"),
        "range": (False, "String.t()"),
    },
    "json.parse": {
        "json": (False, "String.t()"),
        "content": (False, "String.t()"),
        "text": (False, "String.t()"),
        "path": (False, "String.t()"),
    },
    "json.stringify": {
        "data": (False, "term()"),
        "value": (False, "term()"),
        "pretty": (False, "boolean()"),
    },
    "md.code": {
        "content": (False, "String.t()"),
        "text": (False, "String.t()"),
        "lang": (False, "String.t()"),
    },
    "md.concat": {
        "parts": (True, "[String.t()]"),
        "separator": (False, "String.t()"),
    },
    "md.heading": {
        "content": (False, "String.t()"),
        "text": (False, "String.t()"),
        "level": (False, "pos_integer()"),
    },
    "md.table": {
        "data": (False, "[map()]"),
        "columns": (False, "[String.t()]"),
        "key": (False, "String.t()"),
    },
    "memory.by_session": {
        "source_session": (False, "String.t()"),
        "session_id": (False, "String.t()"),
        "exact": (False, "boolean()"),
        "as_of": (False, "String.t() | non_neg_integer()"),
        "valid_at": (False, "String.t()"),
    },
    "memory.overview": {
        "prefix": (False, "String.t()"),
        "limit": (False, "non_neg_integer()"),
        "as_of": (False, "String.t() | non_neg_integer()"),
        "valid_at": (False, "String.t()"),
    },
    "memory.query": {
        "where": (False, "[list()]"),
        "find": (False, "[String.t()]"),
        "datalog": (False, "String.t()"),
        "as_of": (False, "String.t() | non_neg_integer()"),
        "valid_at": (False, "String.t()"),
    },
    "memory.remember": {
        "reason": (True, "String.t()"),
        "facts": (True, "[map()]"),
        "rules": (False, "[String.t()]"),
        "source_session": (False, "String.t()"),
        "session_id": (False, "String.t()"),
    },
    "memory.retract": {
        "reason": (True, "String.t()"),
        "facts": (True, "[map()]"),
        "mode": (False, "String.t()"),
        "valid_at": (False, "String.t()"),
    },
    "memory.transact": {
        "reason": (True, "String.t()"),
        "facts": (False, "[map()]"),
        "rules": (False, "[String.t()]"),
    },
    "pipeline.run": {
        "steps": (True, "[map()]"),
        "seed": (False, "map()"),
        "ctx": (False, "map()"),
        "stop_on_error": (False, "boolean()"),
        "max_steps": (False, "non_neg_integer()"),
    },
    "projects.git_report": {
        "root": (False, "String.t()"),
        "max_depth": (False, "non_neg_integer()"),
    },
    "sessions.search": {
        "pattern": (True, "String.t()"),
        "path": (False, "String.t()"),
        "root": (False, "String.t()"),
        "session_id": (False, "String.t()"),
        "ignore_case": (False, "boolean()"),
        "fixed_strings": (False, "boolean()"),
        "follow_symlinks": (False, "boolean()"),
        "glob": (False, "String.t()"),
        "max_matches": (False, "non_neg_integer()"),
        "timeout_ms": (False, "non_neg_integer()"),
        "snippet": (False, "non_neg_integer()"),
    },
    "sys.cmd": {
        "argv": (True, "[String.t()]"),
        "cwd": (False, "String.t()"),
        "timeout_ms": (False, "non_neg_integer()"),
        "env": (False, "map()"),
        "merge_stderr": (False, "boolean()"),
    },
    "text.grep": {
        "pattern": (True, "String.t()"),
        "text": (False, "String.t()"),
        "path": (False, "String.t()"),
        "ignore_case": (False, "boolean()"),
        "max_matches": (False, "non_neg_integer()"),
    },
    "text.slice": {
        "text": (False, "String.t()"),
        "path": (False, "String.t()"),
        "start_line": (False, "pos_integer()"),
        "end_line": (False, "pos_integer()"),
        "head": (False, "non_neg_integer()"),
        "tail": (False, "non_neg_integer()"),
    },
    "util.binary_strings": {"filter": (False, "String.t()")},
    "util.uuid5_match": {
        "namespaces": (True, "[String.t()]"),
        "targets": (True, "[String.t()]"),
    },
    "weather.current": {
        "place": (False, "String.t()"),
        "location": (False, "String.t()"),
        "city": (False, "String.t()"),
        "country": (False, "String.t()"),
    },
}

SPEC_RE = re.compile(r"^\s*@spec run\(map\(\)\) :: (.+)$", re.MULTILINE)


def slug_from_path(path: Path) -> str:
    rel = path.relative_to(ROOT)
    return "/".join(rel.parts[:-1]).replace("/", ".")


def type_block(slug: str) -> str:
    if slug in ("echo", "debug.echo_args", "pipeline.demo", "runtime.bounce_memory"):
        return ANY
    fields = FIELDS[slug]
    lines = []
    for key in sorted(fields):
        req, typ = fields[key]
        fn = "required" if req else "optional"
        lines.append(f"    {fn}(:{key}) => {typ},")
    body = "\n".join(lines).rstrip(",")
    return f"  @type args :: %{{\n{body}\n  }}"


def patch_tool(path: Path) -> bool:
    slug = slug_from_path(path)
    if slug not in FIELDS:
        raise SystemExit(f"missing FIELDS for {slug}")
    text = path.read_text()
    if "@type args ::" in text:
        return False
    m = SPEC_RE.search(text)
    if not m:
        if slug == "debug.echo_args":
            insert = f"\n{type_block(slug)}\n\n  @spec run(args()) :: {{:ok, map()}} | {{:error, String.t()}}\n\n"
            text = text.replace("  @behaviour AgentFn.Tool\n\n  def run", f"  @behaviour AgentFn.Tool{insert}  def run")
            path.write_text(text)
            return True
        raise SystemExit(f"no @spec run(map()) in {path}")
    ret = m.group(1).strip()
    block = f"{type_block(slug)}\n\n  @spec run(args()) :: {ret}"
    text = SPEC_RE.sub(block, text, count=1)
    path.write_text(text)
    return True


def main() -> None:
    changed = 0
    for path in sorted(ROOT.glob("**/tool.ex")):
        slug = slug_from_path(path)
        if slug.startswith("lib"):
            continue
        if patch_tool(path):
            changed += 1
            print("patched", slug)
    print("done", changed)


if __name__ == "__main__":
    main()
