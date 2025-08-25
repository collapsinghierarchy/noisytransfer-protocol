export const CHUNK_SIZE = 64 * 1024; // 64 KiB

export async function* readChunks(blob) {
  const reader = blob.stream().getReader();
  let pending = new Uint8Array(0);

  // Normalize to a real Uint8Array (not Buffer) without copying the data.
  const toU8 = (u) =>
    u instanceof Uint8Array
      ? new Uint8Array(u.buffer, u.byteOffset, u.byteLength)
      : new Uint8Array(u);

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    let u8 = toU8(value);

    // If we have leftover bytes from the previous read, prepend them.
    if (pending.length) {
      const merged = new Uint8Array(pending.length + u8.length);
      merged.set(pending);
      merged.set(u8, pending.length);
      u8 = merged;
      pending = new Uint8Array(0);
    }

    // Emit full CHUNK_SIZE slices
    let off = 0;
    while (u8.length - off >= CHUNK_SIZE) {
      // subarray returns a Uint8Array view (not a Buffer) because u8 is a real Uint8Array
      yield u8.subarray(off, off + CHUNK_SIZE);
      off += CHUNK_SIZE;
    }

    // Keep any remainder for the next read
    if (off < u8.length) {
      pending = u8.subarray(off);
    }
  }

  // Emit the final partial chunk (if any)
  if (pending.length) yield pending;
}
