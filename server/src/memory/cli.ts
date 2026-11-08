// Memory admin CLI (spec 10 §10.7 rebuild, §10.8 erase / compact). Run while the server is stopped:
// minigraf allows one handle per file.
//   pnpm memory <rebuild|ingest|lint|brief|compact|erase> [space]
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLogger } from "../log.js";
import { sessionBrief } from "./brief.js";
import { claudeRunner, Librarian, lintReport } from "./librarian.js";
import { Memory } from "./memory.js";
import { spacePaths, squashHistory } from "./space.js";
import { TemporalStore } from "./temporal.js";

const env = process.env;
const root = env.HOMUNCULUS_MEMORY_DIR ?? fileURLToPath(new URL("../../.data/memory", import.meta.url));
const [cmd, space = env.HOMUNCULUS_MEMORY_SPACE ?? "default"] = process.argv.slice(2);
const log = createLogger();

async function withLibrarian(fn: (l: Librarian, m: Memory) => Promise<void>): Promise<void> {
  const mem = await Memory.open(root, space, log);
  const lib = new Librarian(mem, claudeRunner(env.HOMUNCULUS_LIBRARIAN_MODEL ?? "claude-sonnet-5-5"), { lintHour: undefined }, log);
  try {
    await fn(lib, mem);
  } finally {
    await lib.close();
    mem.close();
  }
}

switch (cmd) {
  case "rebuild":
  case "ingest":
  case "lint":
    await withLibrarian((l) => l.request(cmd));
    break;
  case "brief": {
    const mem = await Memory.open(root, space, log);
    console.log(await sessionBrief(mem, new Date(), env.HOMUNCULUS_TIMEZONE || undefined));
    console.log(`\n--- lint findings ---\n${(await lintReport(mem)).join("\n") || "none"}`);
    mem.close();
    break;
  }
  case "compact": {
    // Rewrites memory.graph without retracted datoms (and without transaction-time history), squashes git history.
    const s = spacePaths(root, space);
    if (!existsSync(s.graph)) throw new Error(`no memory space ${space}`);
    const old = TemporalStore.open(s.graph);
    const facts = old.facts({ history: true });
    old.close();
    const backup = `${s.graph}.bak`;
    await rename(s.graph, backup);
    const fresh = TemporalStore.open(s.graph);
    for (const f of facts) fresh.restore(f);
    fresh.checkpoint();
    fresh.close();
    await rm(backup);
    await squashHistory(s, "compact");
    log.info("memory_compacted", { space, facts: facts.length });
    break;
  }
  case "erase": {
    const s = spacePaths(root, space);
    await rm(s.root, { recursive: true, force: true });
    log.info("memory_erased", { space, root: s.root });
    break;
  }
  default:
    console.error("usage: pnpm memory <rebuild|ingest|lint|brief|compact|erase> [space]");
    process.exit(2);
}
