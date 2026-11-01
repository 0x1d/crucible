import type { ToolExecuteResult } from "@grok/agent-sdk";
import type { CodexRequest } from "../../../../core/protocol.ts";
import { runCodexOp } from "./elixir-bridge";

/** Surface codex `ok: false` as a harness tool error for the model. */
export async function runCodexTool(
  request: CodexRequest,
): Promise<ToolExecuteResult> {
  const result = await runCodexOp(request);
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok?: boolean }).ok === false
  ) {
    return Object.assign({}, result, { isError: true }) as ToolExecuteResult;
  }
  return result;
}
