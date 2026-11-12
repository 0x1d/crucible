// HDP binary audio frame (spec §4.3). All multi-byte integers big-endian.

export const FrameType = {
  OpusUplink: 0x01,
  OpusDownlink: 0x02,
  Pcm16: 0x03,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const FrameFlag = {
  First: 0x01,
  Last: 0x02,
} as const;

export const FRAME_HEADER_BYTES = 10;
export const FRAME_MS = 60;

export interface AudioFrame {
  type: FrameType;
  /** bit0 = first frame of stream, bit1 = last frame of stream. */
  flags: number;
  /** Uplink: utterance id; downlink: TTS segment id. */
  streamId: number;
  seq: number;
  payload: Uint8Array;
}

export function encodeFrame(f: AudioFrame): Uint8Array {
  if (f.payload.length > 0xffff) throw new RangeError("payload exceeds 65535 bytes");
  const out = new Uint8Array(FRAME_HEADER_BYTES + f.payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, f.type);
  dv.setUint8(1, f.flags);
  dv.setUint16(2, f.streamId);
  dv.setUint32(4, f.seq);
  dv.setUint16(8, f.payload.length);
  out.set(f.payload, FRAME_HEADER_BYTES);
  return out;
}

export class FrameError extends Error {}

export function decodeFrame(buf: Uint8Array): AudioFrame {
  if (buf.length < FRAME_HEADER_BYTES) throw new FrameError("frame shorter than header");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = dv.getUint8(0);
  if (type !== FrameType.OpusUplink && type !== FrameType.OpusDownlink && type !== FrameType.Pcm16) {
    throw new FrameError(`unknown frame type 0x${type.toString(16).padStart(2, "0")}`);
  }
  const len = dv.getUint16(8);
  if (buf.length !== FRAME_HEADER_BYTES + len) {
    throw new FrameError(`payload_len ${len} does not match frame size ${buf.length}`);
  }
  return {
    type,
    flags: dv.getUint8(1),
    streamId: dv.getUint16(2),
    seq: dv.getUint32(4),
    payload: buf.subarray(FRAME_HEADER_BYTES),
  };
}
