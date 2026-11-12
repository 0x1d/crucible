import { defineEvalConfig } from "@grok/agent-sdk/evals";

// One shared MiniGraf BEAM; session_trace seeds wipe the graph.
export default defineEvalConfig({
  maxConcurrency: 1,
});
