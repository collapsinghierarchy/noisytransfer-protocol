import { u32be } from '../util/serial.js';

export function asU8(x) {
  if (x instanceof Uint8Array) return x;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(x)) {
    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  }
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x))    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(0);
}

/** Predicate to decide if a value should be treated as binary. */
export function isByteLike(x) {
  return (
    x instanceof Uint8Array ||
    x instanceof ArrayBuffer ||
    ArrayBuffer.isView(x) ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer?.(x))
  );
}

/** Concatenate ArrayBuffer/TypedArray values; returns ArrayBuffer to match existing ABI. */
export function concat(...bufs) {
  const len = bufs.reduce((n, b) => n + (b.byteLength ?? asU8(b).byteLength), 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const b of bufs) {
    const u8 = asU8(b);
    out.set(u8, off);
    off += u8.byteLength;
  }
  return out.buffer;
}

/** Boolean flag → 1-byte ArrayBuffer (0 | 1). */
export function boolByte(b) {
  const u8 = new Uint8Array(1);
  u8[0] = b ? 1 : 0;
  return u8.buffer;
}

/** length-prefixed concat using your utils; returns Uint8Array for noble */
export function lpConcat(parts) {
  const segs = [];
  for (const p of parts) {
    const u = asU8(p);
    segs.push(asU8(u32be(u.byteLength)), u);
  }
  // your concat returns ArrayBuffer → normalize to Uint8Array for noble
  return asU8(concat(...segs));
}

export function toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += (u8[i] >>> 4).toString(16) + (u8[i] & 15).toString(16);
  return s;
}