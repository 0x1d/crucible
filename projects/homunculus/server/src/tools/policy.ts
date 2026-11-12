// Tool permission policy (spec §5.6): device tools are allowed or need on-device confirmation.
export type ToolPolicy = "allow" | "ask";

/** Device tools the server lets the agent call without asking (safe reads and device actuation, spec §3.4). */
const ALLOWED_DEVICE_TOOLS = new Set([
  "device.set_volume",
  "device.set_brightness",
  "device.show_text",
  "device.show_qr",
  "device.show_image",
  "device.get_status",
  "device.get_time",
  "device.set_timezone",
  "device.get_motion",
  "device.set_timer",
]);

/** Default-deny: a device tool the server does not know (e.g. device.update_firmware) asks on the device. */
export function devicePolicy(deviceToolName: string): ToolPolicy {
  return ALLOWED_DEVICE_TOOLS.has(deviceToolName) ? "allow" : "ask";
}
