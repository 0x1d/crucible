// whisper.cpp STT stream lifecycle against a fake whisper-server (spec §5.4.1).
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { SttResult, SttStream } from "../src/speech/types.js";
import { cleanTranscript, WhisperCppProvider } from "../src/speech/stt/whisper-cpp.js";
import { captureLog } from "./fakes.js";

interface Reply {
  delayMs: number;
  text: string;
}
interface Seen {
  language: string | undefined;
  closedEarly: boolean;
}

let server: Server;
let url = "";
let replies: Reply[] = [];
let seen: Seen[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const lang = /name="language"\r\n\r\n([^\r]*)/.exec(body)?.[1];
      const s: Seen = { language: lang, closedEarly: false };
      seen.push(s);
      const r = replies.shift() ?? { delayMs: 0, text: "" };
      const t = setTimeout(() => res.end(JSON.stringify({ text: r.text })), r.delayMs);
      res.on("close", () => {
        if (!res.writableEnded) {
          s.closedEarly = true;
          clearTimeout(t);
        }
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

function provider(partialIntervalMs = 300) {
  replies = [];
  seen = [];
  return new WhisperCppProvider({ modelPath: "/nonexistent", url, partialIntervalMs, language: "en", log: captureLog() });
}

async function collect(s: SttStream): Promise<SttResult[]> {
  const out: SttResult[] = [];
  for await (const r of s.results()) out.push(r);
  return out;
}

const speech = (ms: number) => new Int16Array((16000 * ms) / 1000).fill(500);

test("partials while speaking, then exactly one final; stream language per request", async () => {
  const p = provider();
  replies = [
    { delayMs: 5, text: " What time" },
    { delayMs: 5, text: " What time is it?" },
  ];
  const s = p.open({ language: "de", sampleRate: 16000 });
  const results = collect(s);
  s.vadHint?.(true);
  s.write(speech(360)); // ≥ 300 ms → partial
  await new Promise((r) => setTimeout(r, 50));
  s.vadHint?.(false);
  s.write(speech(360)); // not speaking → no partial
  s.end();
  assert.deepEqual(await results, [
    { text: "What time", final: false },
    { text: "What time is it?", final: true },
  ]);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((x) => x.language),
    ["de", "de"],
  );
});

test("end() aborts an in-flight partial instead of waiting for it", async () => {
  const p = provider();
  replies = [
    { delayMs: 2000, text: "stale partial" },
    { delayMs: 10, text: "final text" },
  ];
  const s = p.open({ sampleRate: 16000 });
  const results = collect(s);
  s.vadHint?.(true);
  s.write(speech(360));
  await new Promise((r) => setTimeout(r, 30)); // partial request in flight
  const t0 = performance.now();
  s.end();
  assert.deepEqual(await results, [{ text: "final text", final: true }]);
  assert.ok(performance.now() - t0 < 500, `final after ${Math.round(performance.now() - t0)} ms`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(seen[0]?.closedEarly, true);
  assert.equal(seen[1]?.language, "en"); // provider default
});

test("cancel ends results without a final", async () => {
  const p = provider();
  replies = [{ delayMs: 500, text: "never" }];
  const s = p.open({ sampleRate: 16000 });
  const results = collect(s);
  s.write(speech(200));
  s.end();
  await new Promise((r) => setTimeout(r, 30));
  s.cancel();
  assert.deepEqual(await results, []);
});

test("empty audio yields an empty final without a request; non-speech output counts as empty", async () => {
  const p = provider();
  const s = p.open({ sampleRate: 16000 });
  const results = collect(s);
  s.end();
  assert.deepEqual(await results, [{ text: "", final: true }]);
  assert.equal(seen.length, 0);
  assert.equal(cleanTranscript(" [BLANK_AUDIO] "), "");
  assert.equal(cleanTranscript("(wind blowing) Hello  there"), "Hello there");
});
