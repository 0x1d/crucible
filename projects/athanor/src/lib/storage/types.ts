export type StorageBackend = "memory" | "fs" | "s3";

export interface StorageObject {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  updatedAt?: string;
  children?: StorageObject[];
}

export interface StorageProvider {
  readonly id: StorageBackend;
  list(prefix?: string): Promise<StorageObject[]>;
  read(path: string): Promise<string | Uint8Array>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
