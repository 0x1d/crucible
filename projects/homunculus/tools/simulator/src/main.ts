#!/usr/bin/env -S npx tsx
// HDP device simulator (spec 08 §8.1 tools/, Phase 1 p1a).
//
//   hdp-sim [options]                 interactive
//   hdp-sim [options] talk <file>...  one turn per file, then exit
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { ServerMessage } from "@homunculus/protocol";
import { captureMic, decodeFile, Player, writeWav } from "./audio.js";
import { SimDevice, type TurnTimings } from "./device.js";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: process.env.HDP_URL ?? "ws://localhost:8443/hdp" },
    token: { type: "string", default: process.env.HDP_TOKEN ?? "dev" },
    "device-id": { type: "string", default: "02:00:00:00:00:01" },
    model: { type: "string", default: "hdp-sim" },
    mode: { type: "string", default: "auto" },
    trigger: { type: "string", default: "button" },
    "tail-ms": { type: "string", default: "1500" },
    out: { type: "string" },
    play: { type: "boolean", default: false },
    player: { type: "string" },
    "auto-confirm": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const USAGE = `hdp-sim — Homunculus device simulator (HDP/1)

usage: hdp-sim [options] [talk <audio-file>...]

options:
  --url <ws-url>        server endpoint (default ws://localhost:8443/hdp, env HDP_URL)
  --token <token>       device bearer token (default dev, env HDP_TOKEN)
  --device-id <id>      X-Device-Id (default 02:00:00:00:00:01)
  --mode auto|manual    auto = server endpointing, manual = push-to-talk (default auto)
  --trigger <t>         listen trigger: button|touch|wake_word (default button)
  --tail-ms <ms>        auto mode: max silence streamed after the audio (default 1500)
  --out <dir>           write each reply segment as WAV into <dir>
  --play                play replies (env HDP_SIM_PLAYER or --player: aplay|pw-play|paplay|ffplay)
  --auto-confirm        approve confirm.request automatically
  --json                print server messages as raw JSON

interactive commands:
  talk <file> [manual]  send an audio file as one utterance
  ptt                   push-to-talk from the default mic; Enter ends the utterance
  abort                 barge-in: abort current turn/playback
  event <name> [json]   send a device event
  yes | no              answer a pending confirm.request
  quit`;

if (opt.help) {
  console.log(USAGE);
  process.exit(0);
}

const mode = opt.mode === "manual" ? "manual" : "auto";
const trigger = (["button", "touch", "wake_word"].includes(opt.trigger) ? opt.trigger : "button") as
  | "button"
  | "touch"
  | "wake_word";
const tailMs = Number(opt["tail-ms"]);

const device = new SimDevice({
  url: opt.url,
  token: opt.token,
  deviceId: opt["device-id"],
  model: opt.model,
  firmware: "0.1.0-sim",
  autoConfirm: opt["auto-confirm"],
});

const t = () => new Date().toISOString().slice(11, 23);
const print = (s: string) => console.log(`${t()} ${s}`);

function describe(m: ServerMessage): string {
  if (opt.json) return `< ${JSON.stringify(m)}`;
  switch (m.type) {
    case "stt":
      return `< stt${m.final ? "" : " (partial)"}: ${m.text}`;
    case "tts":
      return `< tts ${m.state}${m.segment_id !== undefined ? ` #${m.segment_id}` : ""}${m.text ? `: ${m.text}` : ""}`;
    case "avatar":
      return `< avatar ${[m.state, m.emote && `emote=${m.emote}`, m.intensity !== undefined && `i=${m.intensity}`]
        .filter(Boolean)
        .join(" ")}`;
    case "agent.status":
      return `< agent ${m.phase}${m.tool ? ` ${m.tool}` : ""}${m.detail ? ` (${m.detail})` : ""}`;
    case "error":
      return `< ERROR ${m.code}: ${m.message}`;
    default:
      return `< ${JSON.stringify(m)}`;
  }
}

function printTimings(marks: TurnTimings): void {
  const rows = Object.entries(marks).sort((a, b) => a[1] - b[1]);
  print(`turn timings (ms after end of speech): ${rows.map(([k, v]) => `${k}=${v}`).join("  ")}`);
}

let player: Player | undefined;
let segmentCount = 0;
if (opt.out) mkdirSync(opt.out, { recursive: true });

device.on("message", (m) => print(describe(m)));
device.on("connected", (h) => {
  print(`connected session=${h.session_id} downlink=${h.audio.output.sample_rate} Hz`);
  if (opt.play) player = new Player(h.audio.output.sample_rate, opt.player);
});
device.on("disconnected", (code) => print(`disconnected (${code})`));
device.on("pcm", (_id, pcm) => player?.write(pcm));
device.on("segment", (id, pcm, text) => {
  if (!opt.out) return;
  const file = join(opt.out, `reply-${String(++segmentCount).padStart(3, "0")}-seg${id}.wav`);
  writeWav(file, pcm, device.session?.audio.output.sample_rate ?? 24000);
  print(`saved ${file}${text ? ` (${text})` : ""}`);
});
device.on("turnEnd", printTimings);

function waitTurnEnd(timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      device.off("turnEnd", done);
      device.off("message", onMsg);
      resolve();
    };
    // A turn with nothing to say ends with avatar idle and no tts.
    const onMsg = (m: ServerMessage) => {
      if (m.type === "stt" && m.final && m.text === "") done();
    };
    const timer = setTimeout(done, timeoutMs);
    device.on("turnEnd", done);
    device.on("message", onMsg);
  });
}

async function talkFile(file: string, m: "auto" | "manual"): Promise<void> {
  const pcm = await decodeFile(file);
  print(`> talk ${file} (${(pcm.length / 16000).toFixed(2)} s, ${m})`);
  const turn = waitTurnEnd();
  await device.talk(pcm, { mode: m, trigger, tailMs });
  await turn;
}

try {
  await device.connect();
} catch (e) {
  console.error(`connect failed: ${(e as Error).message}`);
  process.exit(1);
}

if (positionals[0] === "talk") {
  for (const file of positionals.slice(1)) await talkFile(file, mode);
  await new Promise((r) => setTimeout(r, 300)); // let tts.played go out
  await device.close();
  process.exit(0);
}

// Interactive
let pendingConfirm: string | undefined;
let live: { push(pcm: Int16Array): void; stop(): void } | undefined;
let mic: { stop(): void } | undefined;

device.on("confirm", (id, title, detail) => {
  pendingConfirm = id;
  print(`? confirm: ${title} — ${detail}  [yes/no]`);
});

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "hdp> " });
rl.prompt();
rl.on("line", (line) => {
  void (async () => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (live) {
      // Enter ends a push-to-talk utterance.
      mic?.stop();
      live.stop();
      live = undefined;
      print("> ptt end");
      return;
    }
    switch (cmd) {
      case "":
        break;
      case "talk":
        if (!args[0]) print("usage: talk <file> [manual]");
        else await talkFile(args[0], args[1] === "manual" ? "manual" : mode).catch((e) => print(`! ${e.message}`));
        break;
      case "ptt":
        live = device.startLive({ mode: "manual" });
        mic = captureMic((pcm) => live?.push(pcm));
        print("> ptt: speak, then press Enter");
        return;
      case "abort":
        player?.stop();
        device.abort("barge_in");
        break;
      case "event":
        device.send({ type: "event", name: args[0] ?? "ping", data: args[1] ? JSON.parse(args.slice(1).join(" ")) : undefined });
        break;
      case "yes":
      case "no":
        if (!pendingConfirm) print("no pending confirmation");
        else device.send({ type: "confirm.result", request_id: pendingConfirm, approved: cmd === "yes" });
        pendingConfirm = undefined;
        break;
      case "quit":
      case "exit":
        await device.close();
        process.exit(0);
      case "help":
        console.log(USAGE);
        break;
      default:
        print(`unknown command: ${cmd} (help)`);
    }
    rl.prompt();
  })();
});
rl.on("close", () => void device.close().then(() => process.exit(0)));
