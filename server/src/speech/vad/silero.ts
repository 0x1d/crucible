// Silero VAD v5 via onnxruntime-node (spec §5.4.1). 16 kHz, 512-sample windows (32 ms).
import { existsSync } from "node:fs";
import * as ort from "onnxruntime-node";
import type { VadModel, VadModelStream } from "../types.js";

const WINDOW = 512;
const CONTEXT = 64; // v5 expects the last 64 samples of the previous window prepended

export class SileroVad implements VadModel {
  readonly windowSamples = WINDOW;

  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(modelPath: string): Promise<SileroVad> {
    if (!existsSync(modelPath)) throw new Error(`silero model missing: ${modelPath} (run pnpm fetch-models)`);
    const session = await ort.InferenceSession.create(modelPath, {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: "sequential",
    });
    return new SileroVad(session);
  }

  stream(): VadModelStream {
    const session = this.session;
    let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
    let context = new Float32Array(CONTEXT);
    const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
    return {
      async probability(window: Float32Array): Promise<number> {
        const input = new Float32Array(CONTEXT + WINDOW);
        input.set(context);
        input.set(window, CONTEXT);
        context = input.slice(-CONTEXT);
        const out = await session.run({ input: new ort.Tensor("float32", input, [1, CONTEXT + WINDOW]), state, sr });
        state = out.stateN as ort.Tensor;
        return (out.output as ort.Tensor).data[0] as number;
      },
    };
  }
}
