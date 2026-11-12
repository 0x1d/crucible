// Loopback turn handler: echoes each utterance back as TTS downlink.
// Exercises HDP framing, pacing and abort before the speech pipeline exists (Phase 1, p1a).
import { FrameFlag, type AudioFrame } from "@homunculus/protocol";
import type { DeviceConnection } from "../gateway/connection.js";
import { Pacer } from "../gateway/pacer.js";

/** Auto-mode utterances are cut after this long (no server VAD yet). */
const MAX_UTTERANCE_MS = 15_000;

export function attachLoopback(conn: DeviceConnection): void {
  let listening = false;
  let mode: "auto" | "manual" | "realtime" = "auto";
  let frames: Uint8Array[] = [];
  let streamId = -1;
  let segment = 0;
  let speaking = false;
  let maxTimer: NodeJS.Timeout | undefined;
  const pacer = new Pacer<Omit<AudioFrame, "type">>((f) => conn.sendAudio(f));

  const stopSpeaking = () => {
    if (!speaking) return;
    pacer.clear();
    speaking = false;
    conn.send({ type: "tts", state: "stop" });
    conn.send({ type: "avatar", state: "idle" });
  };

  const endpoint = async () => {
    if (!listening) return;
    listening = false;
    clearTimeout(maxTimer);
    if (mode !== "manual") conn.send({ type: "listen", state: "stop" });
    const utterance = frames;
    frames = [];
    const seconds = ((utterance.length * 60) / 1000).toFixed(2);
    conn.send({ type: "stt", text: `loopback: ${utterance.length} frames, ${seconds} s`, final: true });
    if (utterance.length === 0) {
      conn.send({ type: "avatar", state: "idle" });
      return;
    }
    const id = ++segment;
    speaking = true;
    conn.send({ type: "avatar", state: "speaking" });
    conn.send({ type: "tts", state: "start" });
    conn.send({ type: "tts", state: "segment_start", segment_id: id, text: `Echo of ${seconds} seconds.` });
    utterance.forEach((payload, seq) => {
      let flags = 0;
      if (seq === 0) flags |= FrameFlag.First;
      if (seq === utterance.length - 1) flags |= FrameFlag.Last;
      pacer.push({ flags, streamId: id, seq, payload });
    });
    await pacer.drained();
    if (!speaking || segment !== id) return; // aborted or superseded
    conn.send({ type: "tts", state: "segment_end", segment_id: id });
    speaking = false;
    conn.send({ type: "tts", state: "stop" });
    conn.send({ type: "avatar", state: "idle" });
  };

  conn.on("ready", () => conn.send({ type: "avatar", state: "idle" }));

  conn.on("message", (m) => {
    switch (m.type) {
      case "listen":
        if (m.state === "start") {
          stopSpeaking();
          listening = true;
          mode = m.mode ?? "auto";
          frames = [];
          streamId = -1;
          conn.send({ type: "avatar", state: "listening" });
          clearTimeout(maxTimer);
          if (mode !== "manual") maxTimer = setTimeout(() => void endpoint(), MAX_UTTERANCE_MS);
        } else {
          void endpoint();
        }
        break;
      case "abort":
        listening = false;
        clearTimeout(maxTimer);
        frames = [];
        stopSpeaking();
        conn.send({ type: "avatar", state: "idle" });
        break;
      case "tts.played":
        conn.log.debug("tts_played", { segment: m.segment_id });
        break;
      default:
        conn.log.debug("unhandled", { type: m.type });
    }
  });

  conn.on("audio", (f) => {
    if (!listening) return;
    if (streamId !== f.streamId) {
      streamId = f.streamId;
      frames = [];
    }
    frames.push(Uint8Array.from(f.payload));
    if (f.flags & FrameFlag.Last && mode !== "manual") void endpoint();
  });

  conn.on("close", () => {
    clearTimeout(maxTimer);
    pacer.clear();
  });
}
