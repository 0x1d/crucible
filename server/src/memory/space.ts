// Memory space (spec 10 §10.2): directory layout, git versioning of the wiki.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface MemorySpace {
  name: string;
  root: string;
  wiki: string;
  /** temporal-reasoning graph (its fact index and spool live beside it). */
  graph: string;
}

export const SPACE_NAME = /^[a-z0-9-]{1,64}$/;

export function spacePaths(rootDir: string, name: string): MemorySpace {
  if (!SPACE_NAME.test(name)) throw new Error(`invalid memory space name ${name}`);
  const root = join(rootDir, name);
  return { name, root, wiki: join(root, "wiki"), graph: join(root, "temporal.graph") };
}

/** Creates the layout (idempotent) and the git repository; the graph files are not versioned. */
export async function openSpace(rootDir: string, name: string): Promise<MemorySpace> {
  const s = spacePaths(rootDir, name);
  await Promise.all([
    mkdir(join(s.wiki, "entities"), { recursive: true }),
    mkdir(join(s.wiki, "concepts"), { recursive: true }),
  ]);
  const ignore = join(s.root, ".gitignore");
  const ignored = existsSync(ignore) ? await readFile(ignore, "utf8") : "";
  if (!ignored.split("\n").includes("*.graph*")) await writeFile(ignore, `${ignored}*.graph*\n`);
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
