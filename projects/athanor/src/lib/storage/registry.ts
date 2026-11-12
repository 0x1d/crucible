import type { StorageBackend, StorageProvider } from "./types";
import { FsStorage } from "./fs-storage";
import { MemoryStorage } from "./memory-storage";
import { S3Storage } from "./s3-storage";
import { SEED_FILES } from "./seed";

declare global {
  var __nshdeStorage: { backend: StorageBackend; provider: StorageProvider } | undefined;
}

function createProvider(backend: StorageBackend): StorageProvider {
  switch (backend) {
    case "fs":
      return new FsStorage();
    case "s3":
      return new S3Storage();
    case "memory":
    default:
      return new MemoryStorage(SEED_FILES);
  }
}

export function getStorageBackend(): StorageBackend {
  const env = process.env.NSHDE_STORAGE as StorageBackend | undefined;
  return env ?? "fs";
}

let seedPromise: Promise<void> | null = null;

async function ensureSeeded(provider: StorageProvider) {
  if (provider.id !== "fs") return;
  const fs = provider as FsStorage;
  for (const [path, content] of Object.entries(SEED_FILES)) {
    try {
      await fs.read(path);
    } catch {
      await fs.write(path, content);
    }
  }
}

export function getStorageProvider(): StorageProvider {
  if (!global.__nshdeStorage) {
    const backend = getStorageBackend();
    global.__nshdeStorage = { backend, provider: createProvider(backend) };
    seedPromise = ensureSeeded(global.__nshdeStorage.provider);
  }
  return global.__nshdeStorage.provider;
}

export async function getStorageProviderReady(): Promise<StorageProvider> {
  const provider = getStorageProvider();
  if (seedPromise) await seedPromise;
  return provider;
}

export async function setStorageBackend(backend: StorageBackend): Promise<void> {
  const provider = createProvider(backend);
  if (backend === "fs") {
    const fs = provider as FsStorage;
    for (const [path, content] of Object.entries(SEED_FILES)) {
      try {
        await fs.read(path);
      } catch {
        await fs.write(path, content);
      }
    }
  }
  global.__nshdeStorage = { backend, provider };
}

export async function getStorageTree() {
  const provider = await getStorageProviderReady();
  if ("tree" in provider && typeof provider.tree === "function") {
    const children = await provider.tree("components");
    return [
      {
        path: "components",
        name: "components",
        kind: "directory" as const,
        children,
      },
    ];
  }
  const flat = await provider.list("components");
  return [
    {
      path: "components",
      name: "components",
      kind: "directory" as const,
      children: flat,
    },
  ];
}
