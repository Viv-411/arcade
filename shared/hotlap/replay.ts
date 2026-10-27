/**
 * Replays are just the inputs: a run-length list of (ticks held, input bits).
 * Because the simulation is deterministic, inputs alone reproduce the run
 * exactly — for ghosts on the client and for verification on the server.
 *
 * Wire format: base64url of LEB128 varints [bits, count, bits, count, ...].
 */
import { INPUT_MASK } from "./car.js";

export interface InputSpan {
  bits: number;
  ticks: number;
}

export class InputRecorder {
  spans: InputSpan[] = [];
  push(bits: number) {
    const b = bits & INPUT_MASK;
    const last = this.spans[this.spans.length - 1];
    if (last && last.bits === b) last.ticks++;
    else this.spans.push({ bits: b, ticks: 1 });
  }
  get length() {
    let n = 0;
    for (const s of this.spans) n += s.ticks;
    return n;
  }
}

/** Sequential reader: input bits for tick 0, 1, 2, ... (0 after the end). */
export class InputPlayer {
  private i = 0;
  private left: number;
  constructor(private spans: InputSpan[]) {
    this.left = spans[0]?.ticks ?? 0;
  }
  next(): number {
    while (this.i < this.spans.length && this.left === 0) {
      this.i++;
      this.left = this.spans[this.i]?.ticks ?? 0;
    }
    if (this.i >= this.spans.length) return 0;
    this.left--;
    return this.spans[this.i].bits;
  }
  get done() {
    return this.i >= this.spans.length || (this.i === this.spans.length - 1 && this.left === 0);
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeInputs(spans: InputSpan[]): string {
  const bytes: number[] = [];
  const varint = (n: number) => {
    let v = n;
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  for (const s of spans) {
    varint(s.bits);
    varint(s.ticks);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (b !== undefined) out += B64[(n >> 6) & 63];
    if (c !== undefined) out += B64[n & 63];
  }
  return out;
}

/** Decode; throws on malformed input. `maxTicks` bounds work for untrusted data. */
export function decodeInputs(str: string, maxTicks = Infinity): InputSpan[] {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("bad replay encoding");
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const chunk = str.slice(i, i + 4);
    if (chunk.length === 1) throw new Error("bad replay length");
    let n = 0;
    for (let j = 0; j < 4; j++) n = n * 64 + (j < chunk.length ? B64.indexOf(chunk[j]) : 0);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  const nums: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    let v = 0;
    let mul = 1;
    let guard = 0;
    for (;;) {
      if (i >= bytes.length || guard++ > 5) throw new Error("bad varint");
      const b = bytes[i++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) break;
      mul *= 128;
    }
    nums.push(v);
  }
  if (nums.length % 2 !== 0) throw new Error("odd replay");
  const spans: InputSpan[] = [];
  let total = 0;
  for (let k = 0; k < nums.length; k += 2) {
    const bits = nums[k];
    const ticks = nums[k + 1];
    if (bits > 31 || ticks < 1) throw new Error("bad span");
    total += ticks;
    if (total > maxTicks) throw new Error("replay too long");
    spans.push({ bits, ticks });
  }
  return spans;
}
