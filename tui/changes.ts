import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCOPE = "functions/";

export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

/** Tracks files under functions/ that change while the TUI runs. */
export class ChangeTracker {
  private readonly changed = new Set<string>();
  private readonly root: string;
  private snapshot = new Map<string, string>();

  private constructor(root: string) {
    this.root = root;
  }

  static async start(root: string): Promise<ChangeTracker> {
    const tracker = new ChangeTracker(root);
    tracker.snapshot = await tracker.takeSnapshot();
    return tracker;
  }

  /** Compares the tree with the last snapshot and returns the files that changed since then. */
  async refresh(): Promise<FileChange[]> {
    const next = await this.takeSnapshot();
    const paths = new Set([...this.snapshot.keys(), ...next.keys()]);
    const moved = [...paths].filter((p) => this.snapshot.get(p) !== next.get(p)).sort();
    this.snapshot = next;
    if (moved.length === 0) return [];

    const counts = await this.numstat();
    const untracked = new Set(await this.untracked());
    const changes: FileChange[] = [];
    for (const p of moved) {
      this.changed.add(p);
      if (untracked.has(p)) {
        changes.push({ path: p, added: await lineCount(path.join(this.root, p)), removed: 0 });
      } else {
        changes.push({ path: p, ...(counts.get(p) ?? { added: 0, removed: 0 }) });
      }
    }
    return changes;
  }

  /** Unified diff against HEAD for every file that changed while the TUI runs. */
  async diff(): Promise<string> {
    if (this.changed.size === 0) return "";
    const untracked = new Set(await this.untracked());
    const paths = [...this.changed].sort();
    const parts: string[] = [];
    const tracked = paths.filter((p) => !untracked.has(p));
    if (tracked.length > 0) parts.push(await this.git("diff", "HEAD", "--", ...tracked));
    for (const p of paths.filter((p) => untracked.has(p))) {
      parts.push(await this.git("diff", "--no-index", "--", "/dev/null", p));
    }
    return parts.filter(Boolean).join("");
  }

  private async takeSnapshot(): Promise<Map<string, string>> {
    const dirty = (await this.git("diff", "--name-only", "HEAD", "--", SCOPE)).split("\n");
    const paths = [...dirty, ...(await this.untracked())].filter(Boolean);
    const snapshot = new Map<string, string>();
    for (const p of paths) snapshot.set(p, await fileHash(path.join(this.root, p)));
    return snapshot;
  }

  private async numstat(): Promise<Map<string, { added: number; removed: number }>> {
    const out = await this.git("diff", "--numstat", "HEAD", "--", SCOPE);
    const counts = new Map<string, { added: number; removed: number }>();
    for (const line of out.split("\n").filter(Boolean)) {
      const [added, removed, p] = line.split("\t");
      counts.set(p, { added: Number(added) || 0, removed: Number(removed) || 0 });
    }
    return counts;
  }

  private async untracked(): Promise<string[]> {
    const out = await this.git("ls-files", "--others", "--exclude-standard", "--", SCOPE);
    return out.split("\n").filter(Boolean);
  }

  private async git(...args: string[]): Promise<string> {
    try {
      return (await run("git", args, { cwd: this.root, maxBuffer: 16 * 1024 * 1024 })).stdout;
    } catch (error) {
      // `git diff --no-index` exits with 1 when the files differ.
      const e = error as { code?: number; stdout?: string };
      if (e.code === 1 && typeof e.stdout === "string") return e.stdout;
      throw error;
    }
  }
}

async function fileHash(file: string): Promise<string> {
  try {
    return createHash("sha1").update(await fs.readFile(file)).digest("hex");
  } catch {
    return "missing";
  }
}

async function lineCount(file: string): Promise<number> {
  const text = await fs.readFile(file, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
