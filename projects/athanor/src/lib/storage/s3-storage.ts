import type { StorageObject, StorageProvider } from "./types";
import { MemoryStorage } from "./memory-storage";

/**
 * S3-backed storage. When AWS credentials and bucket are configured,
 * swap the in-memory fallback for @aws-sdk/client-s3 calls.
 */
export class S3Storage implements StorageProvider {
  readonly id = "s3" as const;
  private fallback: MemoryStorage;
  private bucket: string;
  private prefix: string;

  constructor(options?: { bucket?: string; prefix?: string }) {
    this.bucket = options?.bucket ?? process.env.NSHDE_S3_BUCKET ?? "nshde-modules";
    this.prefix = options?.prefix ?? process.env.NSHDE_S3_PREFIX ?? "dev/";
    this.fallback = new MemoryStorage({
      "components/demo-counter.nsh.tsx": DEMO_COUNTER,
    });
  }

  async list(prefix = ""): Promise<StorageObject[]> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return this.fallback.list(prefix);
    }
    throw new Error("S3 list: configure AWS SDK integration for production");
  }

  async read(path: string): Promise<string | Uint8Array> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return this.fallback.read(path);
    }
    throw new Error(`S3 read s3://${this.bucket}/${this.prefix}${path}`);
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return this.fallback.write(path, content);
    }
    throw new Error(`S3 write s3://${this.bucket}/${this.prefix}${path}`);
  }

  async delete(path: string): Promise<void> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return this.fallback.delete(path);
    }
    throw new Error(`S3 delete s3://${this.bucket}/${this.prefix}${path}`);
  }

  async mkdir(path: string): Promise<void> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      return this.fallback.mkdir(path);
    }
  }
}

const DEMO_COUNTER = `import { useState } from "react";

export default function DemoCounter() {
  const [n, setN] = useState(0);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-4">
      <p className="text-sm text-zinc-400 mb-2">S3 fallback module</p>
      <p className="text-2xl font-mono text-emerald-400">{n}</p>
      <button
        type="button"
        className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
        onClick={() => setN((c) => c + 1)}
      >
        Increment
      </button>
    </div>
  );
}
`;
