import { defineAgent } from "@grok/agent-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export default defineAgent({
  // Cursor Auto (server-side model routing). Use auto-smart + optimize_for for Router.
  model: "auto",
  local: {
    cwd: repoRoot,
  },
});
