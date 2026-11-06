import fs from "node:fs/promises";
import path from "node:path";
import { RequestError } from "@agentclientprotocol/sdk/unstable";

/** Resolves symlinks in the deepest part of `target` that exists. */
async function realpathOfExisting(target: string): Promise<string> {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing);
    } catch (error) {
      const parent = path.dirname(current);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Maps `fs/*` requests onto disk. An agent reaches only the session harness and the repo. */
export class AcpHarnessFs {
  private readonly roots: () => string[];

  constructor(roots: () => string[]) {
    this.roots = roots;
  }

  private async resolve(requested: string): Promise<string> {
    if (!path.isAbsolute(requested)) {
      throw RequestError.invalidParams({ path: requested }, "path must be absolute");
    }
    const target = await realpathOfExisting(path.normalize(requested));
    const roots = await Promise.all(this.roots().map(realpathOfExisting));
    if (!roots.some((root) => isInside(root, target))) {
      throw RequestError.invalidParams({ path: requested }, "path is outside the session workspace");
    }
    return target;
  }

  /** `line` is 1-based, as in ACP. */
  async read(requested: string, line?: number | null, limit?: number | null): Promise<string> {
    const target = await this.resolve(requested);
    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw RequestError.resourceNotFound(requested);
      }
      throw error;
    }
    if (!line && !limit) return content;
    const start = Math.max((line ?? 1) - 1, 0);
    const end = limit ? start + limit : undefined;
    return content.split("\n").slice(start, end).join("\n");
  }

  async write(requested: string, content: string): Promise<void> {
    const target = await this.resolve(requested);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}
