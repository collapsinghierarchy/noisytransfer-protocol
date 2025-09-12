/** 32-bit unsigned big-endian encoding. */
export const u32be = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
};

export const u64be = (x) => {
  const hi = Math.floor(x / 2**32) >>> 0, lo = (x >>> 0);
  return new Uint8Array([ (hi>>>24)&255, (hi>>>16)&255, (hi>>>8)&255, hi&255,
                          (lo>>>24)&255, (lo>>>16)&255, (lo>>>8)&255, lo&255 ]);
};