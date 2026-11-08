// Device tool bridge and confirmation channel over HDP (spec §5.6, §4.4).
import type { DeviceHello, DeviceMessage, JsonRpcResponse, ServerMessage, ToolDescriptor } from "@homunculus/protocol";
import type { ConfirmRequest, HostTool, ToolOutcome } from "../inference/types.js";
import type { Logger } from "../log.js";
import { devicePolicy } from "./policy.js";

export interface BridgeLink {
  log: Logger;
  send(m: ServerMessage): void;
  on(event: "message", listener: (m: DeviceMessage) => void): unknown;
  off(event: "message", listener: (m: DeviceMessage) => void): unknown;
}

export interface BridgeOptions {
  toolTimeoutMs?: number;
  confirmTimeoutMs?: number;
}

interface Pending<T> {
  resolve(v: T): void;
  timer: NodeJS.Timeout;
  off?: () => void;
}

/** Agent-facing tool name: `device.set_volume` → `set_volume`, restricted to [A-Za-z0-9_-]. */
export function agentToolName(deviceToolName: string): string {
  return deviceToolName.replace(/^device\./, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export class DeviceBridge {
  /** Called with true when a confirmation starts waiting, false when none is waiting any more. */
  onConfirmChange?: (waiting: boolean) => void;
  private nextId = 1;
  private readonly calls = new Map<number | string, Pending<ToolOutcome>>();
  private readonly confirms = new Map<string, Pending<boolean>>();
  private closed = false;
  private readonly log: Logger;
  private readonly toolTimeoutMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly listener = (m: DeviceMessage) => {
    if (m.type === "tool.result") this.onToolResult(m.payload);
    else if (m.type === "confirm.result") this.settleConfirm(m.request_id, m.approved);
  };

  constructor(
    private readonly link: BridgeLink,
    private readonly hello: () => DeviceHello["tools"],
    opts: BridgeOptions = {},
  ) {
    this.log = link.log.child({ component: "bridge" });
    this.toolTimeoutMs = opts.toolTimeoutMs ?? 5000;
    this.confirmTimeoutMs = opts.confirmTimeoutMs ?? 30_000;
    link.on("message", this.listener);
  }

  /** Tools the device declared in `hello`, as agent tools. */
  tools(): HostTool[] {
    const seen = new Set<string>();
    const out: HostTool[] = [];
    for (const d of this.hello() ?? []) {
      const name = agentToolName(d.name);
      if (seen.has(name)) {
        this.log.warn("duplicate_device_tool", { tool: d.name });
        continue;
      }
      seen.add(name);
      out.push(this.hostTool(name, d));
    }
    return out;
  }

  private hostTool(name: string, d: ToolDescriptor): HostTool {
    return {
      name,
      description: d.description,
      inputSchema: d.inputSchema as Record<string, unknown>,
      policy: devicePolicy(d.name),
      call: (args, signal) => this.call(d.name, args, signal),
    };
  }

  /** Invokes a device tool: `tool.call` → `tool.result` (timeout → error outcome). */
  call(deviceToolName: string, args: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
    if (this.closed) return Promise.resolve({ ok: false, text: "device disconnected" });
    const id = this.nextId++;
    return new Promise<ToolOutcome>((resolve) => {
      const finish = (o: ToolOutcome) => {
        const p = this.calls.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        p.off?.();
        this.calls.delete(id);
        resolve(o);
      };
      const onAbort = () => finish({ ok: false, text: "cancelled" });
      const timer = setTimeout(() => {
        this.log.warn("tool_timeout", { tool: deviceToolName });
        finish({ ok: false, text: "the device did not answer in time" });
      }, this.toolTimeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.calls.set(id, {
        resolve: finish,
        timer,
        off: () => signal?.removeEventListener("abort", onAbort),
      });
      if (signal?.aborted) return onAbort();
      this.link.send({
        type: "tool.call",
        payload: { jsonrpc: "2.0", id, method: "tools/call", params: { name: deviceToolName, arguments: args ?? {} } },
      });
    });
  }

  /** Asks the user on the device; denied on timeout, abort, disconnect. */
  confirm(req: ConfirmRequest, signal?: AbortSignal): Promise<boolean> {
    if (this.closed || signal?.aborted) return Promise.resolve(false);
    const requestId = `c${this.nextId++}`;
    const timeoutMs = req.timeoutMs ?? this.confirmTimeoutMs;
    return new Promise<boolean>((resolve) => {
      const onAbort = () => this.settleConfirm(requestId, false);
      const timer = setTimeout(() => {
        this.log.info("confirm_timeout", { tool: req.tool });
        this.settleConfirm(requestId, false);
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.confirms.set(requestId, {
        resolve,
        timer,
        off: () => signal?.removeEventListener("abort", onAbort),
      });
      this.log.info("confirm_request", { tool: req.tool, request: requestId });
      this.link.send({ type: "confirm.request", request_id: requestId, title: req.title, detail: req.detail, timeout_ms: timeoutMs });
      this.onConfirmChange?.(true);
    });
  }

  /** Denies every open confirmation (barge-in). */
  cancelConfirms(): void {
    for (const id of [...this.confirms.keys()]) this.settleConfirm(id, false);
  }

  /** Device gone: fail open calls, deny open confirmations. */
  close(): void {
    this.closed = true;
    this.link.off("message", this.listener);
    for (const p of [...this.calls.values()]) p.resolve({ ok: false, text: "device disconnected" });
    this.cancelConfirms();
  }

  private settleConfirm(requestId: string, approved: boolean): void {
    const p = this.confirms.get(requestId);
    if (!p) return;
    clearTimeout(p.timer);
    p.off?.();
    this.confirms.delete(requestId);
    this.log.info("confirm_result", { request: requestId, approved });
    p.resolve(approved);
    if (this.confirms.size === 0) this.onConfirmChange?.(false);
  }

  private onToolResult(r: JsonRpcResponse): void {
    const p = this.calls.get(r.id);
    if (!p) return this.log.debug("unmatched_tool_result", { id: r.id });
    p.resolve(toOutcome(r));
  }
}

function toOutcome(r: JsonRpcResponse): ToolOutcome {
  if (r.error) return { ok: false, text: r.error.message };
  const res = r.result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
  const text = Array.isArray(res?.content)
    ? res.content.flatMap((c) => (c.type === "text" && typeof c.text === "string" ? [c.text] : [])).join("\n")
    : JSON.stringify(r.result ?? null);
  return { ok: res?.isError !== true, text };
}
