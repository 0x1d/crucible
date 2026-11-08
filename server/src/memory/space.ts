// Memory space (spec 10 §10.2): directory layout, git versioning.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_SCHEMA } from "./schema.js";

const run = promisify(execFile);

export interface MemorySpace {
  name: string;
  root: string;
  sources: string;
  inbox: string;
  wiki: string;
  schema: string;
  index: string;
  brief: string;
  log: string;
  graph: string;
}

export const SPACE_NAME = /^[a-z0-9-]{1,64}$/;

export function spacePaths(rootDir: string, name: string): MemorySpace {
  if (!SPACE_NAME.test(name)) throw new Error(`invalid memory space name ${name}`);
  const root = join(rootDir, name);
  const wiki = join(root, "wiki");
  return {
    name,
    root,
    sources: join(root, "sources"),
    inbox: join(root, "inbox.md"),
    wiki,
    schema: join(wiki, "SCHEMA.md"),
    index: join(wiki, "index.md"),
    brief: join(wiki, "brief.md"),
    log: join(wiki, "log.md"),
    graph: join(root, "memory.graph"),
  };
}

/** Creates the layout (idempotent) and the git repository. */
export async function openSpace(rootDir: string, name: string): Promise<MemorySpace> {
  const s = spacePaths(rootDir, name);
  await Promise.all([
    mkdir(s.sources, { recursive: true }),
    mkdir(join(s.wiki, "entities"), { recursive: true }),
    mkdir(join(s.wiki, "concepts"), { recursive: true }),
  ]);
  const seed: Array<[string, string]> = [
    [s.schema, DEFAULT_SCHEMA],
    [s.inbox, ""],
    [s.log, "---\ningested: []\n---\n\n# Librarian log\n"],
    [join(s.root, ".gitignore"), "memory.graph*\n"],
  ];
  for (const [p, content] of seed) if (!existsSync(p)) await writeFile(p, content);
  if (!existsSync(join(s.root, ".git"))) {
    await git(s, "init", "-q");
    await commit(s, "init");
  }
  return s;
}

const GIT_ID = ["-c", "user.name=homunculus", "-c", "user.email=homunculus@localhost", "-c", "commit.gpgsign=false"];

async function git(s: MemorySpace, ...args: string[]): Promise<string> {
  const r = await run("git", ["-C", s.root, ...GIT_ID, ...args]);
  return r.stdout;
}

/** Commits all changes; no-op when the tree is clean. Returns whether a commit was made. */
export async function commit(s: MemorySpace, message: string): Promise<boolean> {
  await git(s, "add", "-A");
  const status = await git(s, "status", "--porcelain");
  if (!status.trim()) return false;
  await git(s, "commit", "-q", "-m", message);
  return true;
}

/** Replaces the git history with one commit of the current tree (memory compact). */
export async function squashHistory(s: MemorySpace, message: string): Promise<void> {
  await git(s, "checkout", "-q", "--orphan", "compact");
  await git(s, "add", "-A");
  await git(s, "commit", "-q", "--allow-empty", "-m", message);
  const branches = (await git(s, "branch", "--format=%(refname:short)")).split("\n").filter((b) => b && b !== "compact");
  for (const b of branches) await git(s, "branch", "-D", b);
  await git(s, "branch", "-m", "main");
  await git(s, "reflog", "expire", "--expire=now", "--all");
  await git(s, "gc", "-q", "--prune=now");
}
