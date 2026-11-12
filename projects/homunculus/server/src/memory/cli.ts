// Memory admin CLI (spec 10 §10.8). Run while the server is stopped (one graph handle).
//   pnpm memory query '<datalog>' [space]   read-only Datalog on the temporal graph
//   pnpm memory erase [space]               delete the space (graph and wiki)
import { rm } from "node:fs/promises";
import { memoryDir } from "../data-dir.js";
import { createLogger } from "../log.js";
import { spacePaths } from "./space.js";
import { TemporalReasoning } from "./temporal-reasoning.js";

const env = process.env;
const root = memoryDir(env);
const [cmd, ...rest] = process.argv.slice(2);
const log = createLogger();

switch (cmd) {
  case "query": {
    const [datalog, space = env.HOMUNCULUS_MEMORY_SPACE ?? "default"] = rest;
    if (!datalog) throw new Error("usage: pnpm memory query '<datalog>' [space]");
    const s = spacePaths(root, space);
    const tr = new TemporalReasoning(
      { graphPath: s.graph, cwd: s.root, sample: () => Promise.reject(new Error("no sampling in the CLI")) },
      log,
    );
    try {
      const r = await tr.call("minigraf_query", { datalog });
      console.log(r.text);
    } finally {
      await tr.close();
    }
    break;
  }
  case "erase": {
    const s = spacePaths(root, rest[0] ?? env.HOMUNCULUS_MEMORY_SPACE ?? "default");
    await rm(s.root, { recursive: true, force: true });
    log.info("memory_erased", { root: s.root });
    break;
  }
  default:
    console.error("usage: pnpm memory <query '<datalog>'|erase> [space]");
    process.exit(2);
}
