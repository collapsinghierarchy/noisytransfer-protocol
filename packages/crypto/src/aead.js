// src/crypto/aead.js
import { asU8 } from "../util/buffer.js";
import { NoisyError } from "../errors/noisy-error.js";

const te = new TextEncoder();

/** Ensure a 12-byte IV (96-bit). */
function assertIv12(iv) {
  if (!(iv instanceof Uint8Array) || iv.length !== 12) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "crypto/aead: AES-GCM baseIV must be 12 bytes" });
  }
}

/** Import an AES-GCM key from raw bytes (16/24/32). */
async function importAesGcm(keyBytes) {
  const k = asU8(keyBytes);
  if (![16, 24, 32].includes(k.length)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: `crypto/aead: AES key length must be 16/24/32, got ${k.length}` });
  }
  return crypto.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Derive per-chunk IV by adding idx (uint32, big-endian) into the LOW 32 bits (bytes 8..11)
 * of a 96-bit base IV. High 64 bits (bytes 0..7) remain unchanged.
 * Invariant: "96-bit IV, BE counter in low 32 bits".
 */
export function deriveIv(baseIV, idx) {
  assertIv12(baseIV);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "crypto/aead: idx must be a non-negative integer" });
  }
  const iv = new Uint8Array(baseIV); // copy

  // Read BE uint32 from bytes 8..11
  let ctr = (iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | (iv[11] << 0);
  // Add idx modulo 2^32
  ctr = (ctr + (idx >>> 0)) >>> 0;
  // Write back BE
  iv[8]  = (ctr >>> 24) & 0xff;
  iv[9]  = (ctr >>> 16) & 0xff;
  iv[10] = (ctr >>> 8)  & 0xff;
  iv[11] = (ctr >>> 0)  & 0xff;

  return iv;
}

/** Build AAD in the exact literal order you already use. */
function buildAAD(id, idx) {
  // Keep JSON to preserve existing compatibility
  return te.encode(JSON.stringify({ id, n: idx }));
}

/**
 * Create an encryptor.
 * - alg: "AES-GCM"
 * - baseIV: 12-byte Uint8Array (exported so it can be included in KeyPacket)
 * - seal(id, idx, pt): returns ciphertext+tag (Uint8Array)
 */
export async function makeEncryptor(
  keyBytes,
  baseIV = crypto.getRandomValues(new Uint8Array(12))
) {
  assertIv12(baseIV);
  const key = await importAesGcm(keyBytes);
  const baseIVCopy = new Uint8Array(baseIV); // immutability outward

  async function seal(id, idx, pt) {
    try {
      const iv  = deriveIv(baseIVCopy, idx);
      const aad = buildAAD(id, idx);
      const u8  = asU8(pt);
      const ct  = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, u8);
      return new Uint8Array(ct);
    } catch (cause) {
      throw new NoisyError({ code: "NC_AEAD_FAILED", message: "AES-GCM seal failed", cause });
    }
  }

  return {
    alg: "AES-GCM",
    baseIV: baseIVCopy,
    seal,
    // alias for readability in callers
    encryptChunk: seal,
  };
}

/**
 * Create a decryptor compatible with makeEncryptor.
 * - open(id, idx, ct): returns plaintext (Uint8Array) or throws NoisyError
 */
export async function makeDecryptor(keyBytes, baseIV) {
  assertIv12(baseIV);
  const key = await importAesGcm(keyBytes);
  const baseIVCopy = new Uint8Array(baseIV);

  async function open(id, idx, ct) {
    try {
      const iv  = deriveIv(baseIVCopy, idx);
      const aad = buildAAD(id, idx);
      const u8  = asU8(ct);
      const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, u8);
      return new Uint8Array(pt);
    } catch (cause) {
      // WebCrypto throws on tag mismatch / wrong key / wrong AAD
      throw new NoisyError({ code: "NC_AEAD_FAILED", message: "AES-GCM open failed", cause });
    }
  }

  return {
    open,
    // alias for readability in callers
    decryptChunk: open,
  };
}
