import { fileURLToPath } from "node:url";

/** Model cache (gitignored); filled by `pnpm fetch-models`. */
export const modelDir = process.env.HOMUNCULUS_MODEL_DIR ?? fileURLToPath(new URL("../../models", import.meta.url));
