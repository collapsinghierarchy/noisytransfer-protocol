import { asU8, concat, toHex, fromHex } from "@noisytransfer/util";
import { u32be } from "@noisytransfer/util/serial";
import { createHash as nodeCreateHash, webcrypto as nodeCrypto } from "node:crypto";
import { Readable } from "node:stream";

const cryptoImpl = globalThis.crypto ?? nodeCrypto;

// Node helpers ---------------------------------------------------------------
export function createSHA256() {
  return nodeCreateHash("sha256");
}

export { Readable };

/** SHA-256 via WebCrypto; returns Uint8Array */
export async function sha256(data) {
  const u = asU8(data);
  const view = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  const hash = await cryptoImpl.subtle.digest("SHA-256", view);
  return new Uint8Array(hash);
}

/** Constant-time equality for byte-like inputs */
export function constantTimeEqual(a, b) {
  const ua = asU8(a),
    ub = asU8(b);
  if (ua.byteLength !== ub.byteLength) return false;
  let r = 0;
  for (let i = 0; i < ua.byteLength; i++) r |= ua[i] ^ ub[i];
  return r === 0;
}

/* ------------------------- SHA3 / SHAKE provider -------------------------- */
let noble = null;
async function ensureNoble() {
  if (noble) return;
  try {
    noble = await import("@noble/hashes/sha3"); // { sha3_256, shake128 }
  } catch {
    noble = null; // stay null; callers handle fallback
  }
}

/** SHA3-256; falls back to SHA-256 if @noble/hashes is missing */
export async function sha3_256(data) {
  await ensureNoble();
  const u = asU8(data);
  if (noble?.sha3_256) return noble.sha3_256(u);
  return sha256(u); // conservative fallback
}

/** SHAKE128 XOF; falls back to SHA-256-based expander (deterministic PRF) */
export async function shake128(input, dkLen) {
  await ensureNoble();
  const u = asU8(input);
  if (noble?.shake128) return noble.shake128(u, { dkLen });
  return xofSha256(u, dkLen);
}

/** Deterministic, conservative PRF fallback using repeated SHA-256 with counter */
async function xofSha256(seed, dkLen) {
  const out = new Uint8Array(dkLen);
  let pos = 0,
    ctr = 1;
  while (pos < dkLen) {
    const blockAB = concat(seed, asU8(u32be(ctr))); // concat → ArrayBuffer
    const block = await sha256(blockAB); // → Uint8Array
    const take = Math.min(block.length, dkLen - pos);
    out.set(block.subarray(0, take), pos);
    pos += take;
    ctr++;
  }
  return out;
}
