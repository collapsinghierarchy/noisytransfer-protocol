import { concat, boolByte } from "@noisytransfer/util/buffer.js";
import { u32be } from "@noisytransfer/util/serial.js";
import { createVerify as nodeCreateVerify } from 'node:crypto';


/**
 * Generate an ephemeral RSA-PSS key pair for signing/verifying.
 * @returns {Promise<{verificationKey: Uint8Array, signingKey: CryptoKey}>}
 */
export async function genRSAPSS() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return {
    verificationKey: new Uint8Array(spki), //needs to be portable → exported to bytes (ArrayBuffer/Uint8Array)
    signingKey: privateKey, //stays internal → kept as CryptoKey
  };
}

/**
 * Sign data with RSA-PSS (saltLength equal to hash length).
 * @param {CryptoKey} signingKey
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
export async function signChunk(signingKey, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const sig = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    signingKey,
    u8
  );
  return new Uint8Array(sig);
}

export async function importVerifyKey(spkiBytesU8) {
  const spki = spkiBytesU8 instanceof Uint8Array ? spkiBytesU8 : new Uint8Array(spkiBytesU8);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSA-PSS", hash: "SHA-256" },
    true,
    ["verify"]
  );
}

/**
 * Verify a signature.
 * @param {CryptoKey} verifyKey
 * @param {ArrayBuffer|Uint8Array} signature
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<boolean>}
 */
export async function verifyChunk(verifyKey, signature, data) {
  const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  return crypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    verifyKey,
    sig,
    d
  );
}


// Node helpers ---------------------------------------------------------------

export function createRSAVerifier() {
  return nodeCreateVerify('RSA-SHA256');
}