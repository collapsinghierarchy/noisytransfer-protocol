import { CHUNK_SIZE } from "@noisytransfer/noisytransfer-protocol/protocol/constants.js";

export async function* readChunks(blob) {
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (let off = 0; off < value.byteLength; off += CHUNK_SIZE) {
      yield value.subarray(off, off + CHUNK_SIZE);
    }
  }
}