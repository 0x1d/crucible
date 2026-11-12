// Audio I/O helpers for the simulator: file decode and mic capture via ffmpeg,
// WAV writing, playback via an external player.
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";

export const UPLINK_RATE = 16000;
export const FRAME_SAMPLES_16K = 960; // 60 ms

/** Decodes any audio file ffmpeg understands to PCM16 mono at `rate`. */
export function decodeFile(path: string, rate = UPLINK_RATE): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", String(rate), "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => (err += c.toString()));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`));
      const buf = Buffer.concat(chunks);
      resolve(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1).slice());
    });
  });
}

/** Captures the default PulseAudio/PipeWire source as PCM16 mono 16 kHz, delivered in 60 ms frames. */
export function captureMic(onFrame: (pcm: Int16Array) => void): { stop(): void } {
  const ff = spawn(
    "ffmpeg",
    ["-v", "error", "-f", "pulse", "-i", "default", "-f", "s16le", "-ac", "1", "-ar", String(UPLINK_RATE), "-"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let pending = Buffer.alloc(0);
  const frameBytes = FRAME_SAMPLES_16K * 2;
  ff.stdout.on("data", (c: Buffer) => {
    pending = Buffer.concat([pending, c]);
    while (pending.length >= frameBytes) {
      const f = pending.subarray(0, frameBytes);
      pending = pending.subarray(frameBytes);
      onFrame(new Int16Array(f.buffer.slice(f.byteOffset, f.byteOffset + frameBytes)));
    }
  });
  return { stop: () => ff.kill("SIGTERM") };
}

export function writeWav(path: string, pcm: Int16Array, rate: number): void {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** Streams raw PCM16 mono to an external player (stdin). */
export class Player {
  private proc: ChildProcess | undefined;

  constructor(
    private readonly rate: number,
    private readonly command = process.env.HDP_SIM_PLAYER ?? "aplay",
  ) {}

  write(pcm: Int16Array): void {
    if (!this.proc || this.proc.exitCode !== null) this.proc = this.spawn();
    this.proc.stdin?.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  /** Stops playback immediately (barge-in). */
  stop(): void {
    this.proc?.kill("SIGKILL");
    this.proc = undefined;
  }

  private spawn(): ChildProcess {
    const r = String(this.rate);
    const args: Record<string, string[]> = {
      aplay: ["-q", "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", r],
      "pw-play": ["--format", "s16", "--channels", "1", "--rate", r, "-"],
      paplay: ["--raw", "--format=s16le", "--channels=1", `--rate=${r}`],
      ffplay: ["-nodisp", "-autoexit", "-loglevel", "error", "-f", "s16le", "-ch_layout", "mono", "-ar", r, "-"],
    };
    const p = spawn(this.command, args[this.command] ?? [], { stdio: ["pipe", "ignore", "inherit"] });
    p.stdin?.on("error", () => {});
    return p;
  }
}
