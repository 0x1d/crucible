import { createInterface } from "node:readline";
import {
  closeGraph,
  dispatch,
  openGraph,
  type Graph,
} from "./minigraf-memory.ts";

const file = process.argv[2];
if (!file) {
  console.log(JSON.stringify({ ok: false, error: "memory path is required" }));
  process.exit(1);
}

let graph: Graph;
try {
  graph = openGraph(file);
} catch (error) {
  const message = error instanceof Error ? error.message : "minigraf failed to start";
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

console.log(JSON.stringify({ ready: true }));

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  let id: number | undefined;
  try {
    const request = JSON.parse(line) as {
      id?: number;
      op?: string;
      args?: unknown;
      path?: string;
    };
    id = request.id;
    if (request.op === "close") {
      closeGraph(graph);
      console.log(JSON.stringify({ id, ok: true, result: {} }));
      process.exit(0);
    }
    if (request.op === "reset") {
      const previous = graph;
      closeGraph(previous);
      try {
        graph = openGraph(String(request.path));
      } catch (error) {
        graph = openGraph(previous.path);
        throw error;
      }
      console.log(JSON.stringify({ id, ok: true, result: {} }));
      return;
    }
    const result = dispatch(graph, String(request.op), request.args);
    console.log(JSON.stringify({ id, ok: true, result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory request failed";
    console.log(JSON.stringify({ id, ok: false, error: message }));
  }
});
