// Homunculus server entry point.
import { readFileSync } from "node:fs";
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

const deviceTokens = (env.HOMUNCULUS_DEVICE_TOKENS ?? "").split(",").filter(Boolean);
if (deviceTokens.length === 0) {
  if (tls) throw new Error("HOMUNCULUS_DEVICE_TOKENS must be set when TLS is enabled");
  deviceTokens.push("dev");
  log.warn("dev_token", { note: "HOMUNCULUS_DEVICE_TOKENS unset; accepting token 'dev' (plain ws)" });
}

// HOMUNCULUS_PIPELINE: "speech" (default, spec §5.2) or "loopback" (echo, p1a).
const mode = env.HOMUNCULUS_PIPELINE ?? "speech";
if (mode !== "speech" && mode !== "loopback") throw new Error(`unknown HOMUNCULUS_PIPELINE ${mode}`);
const pipeline = mode === "speech" ? await createSpeechPipeline(log) : undefined;

const gateway = await startGateway({
  host: env.HOMUNCULUS_HOST ?? "0.0.0.0",
  port: Number(env.HOMUNCULUS_PORT ?? 8443),
  tls,
  deviceTokens,
  config: { follow_up_window_ms: 6000, captions: true, language: "en" },
  onConnection: pipeline ? (c) => pipeline.attach(c) : attachLoopback,
  log,
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    log.info("shutdown", { signal: sig });
    void Promise.all([gateway.close(), pipeline?.close()]).then(() => process.exit(0));
  });
}
