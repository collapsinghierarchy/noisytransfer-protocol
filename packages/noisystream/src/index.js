// Public, stable surface for noisystream.
// Invariants:
// - Frames: stream_init -> stream_ready -> stream_data* -> stream_fin
// - Sender waits for stream_ready before sending data frames.
// - AEAD nonces use 96-bit IV with BE counter in low 32 bits (unchanged here).
// - Final RSA-PSS signature covers the ciphertext transcript (unchanged).

export { sendFileWithAuth } from "./sender.js";
export { recvFileWithAuth } from "./receiver.js";
export * from "./frames.js";