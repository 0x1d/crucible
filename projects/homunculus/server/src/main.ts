// Homunculus server entry point.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bonjour } from "bonjour-service";
import { AdminKey, DeviceRegistry, Pairings } from "./admin/devices.js";
import { startGateway } from "./gateway/server.js";
import { createLogger } from "./log.js";
import { attachLoopback } from "./orchestrator/loopback.js";
import { createSpeechPipeline } from "./orchestrator/pipeline.js";

const env = process.env;
const log = createLogger();

// A failure in one device's turn must not take down every connected device.
process.on("unhandledRejection", (e) => log.error("unhandled_rejection", { error: String(e) }));

const tls =
  env.HOMUNCULUS_TLS_CERT && env.HOMUNCULUS_TLS_KEY
    ? { cert: readFileSync(env.HOMUNCULUS_TLS_CERT), key: readFileSync(env.HOMUNCULUS_TLS_KEY) }
    : undefined;

// Shared tokens (any device id); unset: the development token `dev`, from loopback only (simulator).
const deviceTokens = (env.HOMUNCULUS_DEVICE_TOKENS ?? "").split(",").filter(Boolean);
const loopbackTokens = deviceTokens.length === 0 ? ["dev"] : [];

// Paired devices and the admin key (spec 03 §3.5).
const dataDir = env.HOMUNCULUS_DATA_DIR ?? fileURLToPath(new URL("../.data", import.meta.url));
const registry = new DeviceRegistry(join(dataDir, "devices.json"));
const adminKey = AdminKey.load(dataDir, env.HOMUNCULUS_ADMIN_KEY);
const pairings = new Pairings(registry);

// HOMUNCULUS_PIPELINE: "speech" (default, spec §5.2) or "loopback" (echo, p1a).
const mode = env.HOMUNCULUS_PIPELINE ?? "speech";
if (mode !== "speech" && mode !== "loopback") throw new Error(`unknown HOMUNCULUS_PIPELINE ${mode}`);
const pipeline = mode === "speech" ? await createSpeechPipeline(log) : undefined;

const gateway = await startGateway({
  host: env.HOMUNCULUS_HOST ?? "0.0.0.0",
  port: Number(env.HOMUNCULUS_PORT ?? 8443),
  tls,
  deviceTokens,
  loopbackTokens,
  devices: { registry, pairings, adminKey },
  // Firmware images <model>.bin for OTA (make fw-publish).
  otaDir: env.HOMUNCULUS_OTA_DIR ?? join(dataDir, "ota"),
  config: { follow_up_window_ms: 6000, captions: true, language: "en" },
  onConnection: pipeline ? (c) => pipeline.attach(c) : attachLoopback,
  log,
});

// mDNS `_homunculus._tcp` for device discovery (HOMUNCULUS_MDNS=0 disables).
const bonjour = env.HOMUNCULUS_MDNS === "0" ? undefined : new Bonjour();
bonjour?.publish({
  name: env.HOMUNCULUS_MDNS_NAME ?? "Homunculus",
  type: "homunculus",
  port: gateway.port,
  txt: { path: "/hdp", tls: tls ? "1" : "0", id: registry.serverId },
});
log.info("mdns", { enabled: bonjour !== undefined, service: "_homunculus._tcp", id: registry.serverId });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    log.info("shutdown", { signal: sig });
    const mdns = new Promise<void>((r) => (bonjour ? bonjour.unpublishAll(() => bonjour.destroy(() => r())) : r()));
    void Promise.all([gateway.close(), pipeline?.close(), mdns]).then(() => process.exit(0));
  });
}
