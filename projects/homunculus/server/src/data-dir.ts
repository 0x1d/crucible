// Root of all server state (spec crucible/homunculus/server/design section 9):
// devices.json, admin-key, ota/, memory/, sandbox/devices/.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `HOMUNCULUS_DATA_DIR`, default `server/.data`. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOMUNCULUS_DATA_DIR || fileURLToPath(new URL("../.data", import.meta.url));
}

/** `HOMUNCULUS_MEMORY_DIR`, default `<data dir>/memory`. */
export function memoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOMUNCULUS_MEMORY_DIR || join(dataDir(env), "memory");
}
