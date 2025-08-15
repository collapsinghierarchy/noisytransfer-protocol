/** 32-bit unsigned big-endian encoding. */
export const u32be = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
};