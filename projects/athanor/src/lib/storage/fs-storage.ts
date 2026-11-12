import fs from "fs/promises";
import path from "path";
import type { StorageObject, StorageProvider } from "./types";

const DATA_ROOT = path.join(process.cwd(), ".nshde-data");

function normalize(rel: string): string {
  const n = rel.replace(/^\/+/, "").replace(/\/+$/, "");
  if (n.includes("..")) throw new Error("Invalid path");
  return n;
}

function abs(rel: string): string {
  return path.join(DATA_ROOT, normalize(rel));
}

async function ensureRoot() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

export class FsStorage implements StorageProvider {
  readonly id = "fs" as const;

  async list(prefix = ""): Promise<StorageObject[]> {
    await ensureRoot();
    const dir = abs(prefix || ".");
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const items: StorageObject[] = [];
    for (const ent of entries) {
      const name = String(ent.name);
      if (name.startsWith(".")) continue;
      const rel = prefix ? `${normalize(prefix)}/${name}` : name;
      if (ent.isDirectory()) {
        items.push({ path: rel, name, kind: "directory", children: [] });
      } else {
        const st = await fs.stat(abs(rel));
        items.push({
          path: rel,
          name,
          kind: "file",
          size: st.size,
          updatedAt: st.mtime.toISOString(),
        });
      }
    }
    return items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async read(filePath: string): Promise<string | Uint8Array> {
    await ensureRoot();
    const p = abs(filePath);
    const buf = await fs.readFile(p);
    if (filePath.endsWith(".wasm")) return new Uint8Array(buf);
    return buf.toString("utf8");
  }

  async write(filePath: string, content: string | Uint8Array): Promise<void> {
    await ensureRoot();
    const p = abs(filePath);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (typeof content === "string") {
      await fs.writeFile(p, content, "utf8");
    } else {
      await fs.writeFile(p, Buffer.from(content));
    }
  }

  async delete(filePath: string): Promise<void> {
    await ensureRoot();
    await fs.rm(abs(filePath), { recursive: true, force: true });
  }

  async mkdir(dirPath: string): Promise<void> {
    await ensureRoot();
    await fs.mkdir(abs(dirPath), { recursive: true });
  }

  async tree(prefix = ""): Promise<StorageObject[]> {
    const items = await this.list(prefix);
    const result: StorageObject[] = [];
    for (const item of items) {
      if (item.kind === "directory") {
        result.push({ ...item, children: await this.tree(item.path) });
      } else {
        result.push(item);
      }
    }
    return result;
  }
}
