import type { StorageObject, StorageProvider } from "./types";

function normalize(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export class MemoryStorage implements StorageProvider {
  readonly id = "memory" as const;
  private files = new Map<string, { content: string | Uint8Array; updatedAt: string }>();

  constructor(seed?: Record<string, string>) {
    if (seed) {
      for (const [path, content] of Object.entries(seed)) {
        this.files.set(normalize(path), {
          content,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async list(prefix = ""): Promise<StorageObject[]> {
    const p = normalize(prefix);
    const dirs = new Set<string>();
    const files: StorageObject[] = [];

    for (const key of this.files.keys()) {
      if (p && !key.startsWith(p + "/") && key !== p) continue;
      const rest = p ? key.slice(p.length + 1) : key;
      if (!rest) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        const meta = this.files.get(key)!;
        files.push({
          path: key,
          name: rest,
          kind: "file",
          size: typeof meta.content === "string" ? meta.content.length : meta.content.byteLength,
          updatedAt: meta.updatedAt,
        });
      } else {
        dirs.add(rest.slice(0, slash));
      }
    }

    const dirNodes: StorageObject[] = [...dirs].sort().map((name) => ({
      path: p ? `${p}/${name}` : name,
      name,
      kind: "directory" as const,
      children: [],
    }));

    return [...dirNodes, ...files.sort((a, b) => a.name.localeCompare(b.name))];
  }

  async read(path: string): Promise<string | Uint8Array> {
    const key = normalize(path);
    const entry = this.files.get(key);
    if (!entry) throw new Error(`Not found: ${path}`);
    return entry.content;
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(normalize(path), {
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  async delete(path: string): Promise<void> {
    const key = normalize(path);
    this.files.delete(key);
    for (const k of [...this.files.keys()]) {
      if (k.startsWith(key + "/")) this.files.delete(k);
    }
  }

  async mkdir(path: string): Promise<void> {
    const key = normalize(path);
    const placeholder = `${key}/.keep`;
    if (!this.files.has(placeholder)) {
      await this.write(placeholder, "");
    }
  }

  async tree(prefix = ""): Promise<StorageObject[]> {
    const items = await this.list(prefix);
    const result: StorageObject[] = [];
    for (const item of items) {
      if (item.kind === "directory") {
        result.push({
          ...item,
          children: await this.tree(item.path),
        });
      } else if (!item.name.startsWith(".")) {
        result.push(item);
      }
    }
    return result;
  }
}
