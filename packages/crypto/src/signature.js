import { createVerify as nodeCreateVerify } from "node:crypto";
import {sha256} from "./hash.js";
import {concatU8, u32be, u64be} from "@noisytransfer/util";

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
  const sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, signingKey, u8);
  return new Uint8Array(sig);
}

export async function importVerifyKey(spkiBytesU8) {
  const spki = spkiBytesU8 instanceof Uint8Array ? spkiBytesU8 : new Uint8Array(spkiBytesU8);
  return crypto.subtle.importKey("spki", spki, { name: "RSA-PSS", hash: "SHA-256" }, true, [
    "verify",
  ]);
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
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, verifyKey, sig, d);
}

// Deterministic, incremental transcript over ciphertext
export async function sigInit({ sessionId, totalBytes, hpkeEnc, aadId }) {
  const te = new TextEncoder();
  const tag = (s) => te.encode(s);
  // H0 = sha256( "ns-sig/v1" || sid || 0x00 || u64(totalBytes?) || 0x00 || aadId || 0x00 || hpkeEnc )
  const sid   = te.encode(String(sessionId || ""));
  const tbytes = Number.isFinite(totalBytes) ? u64be(totalBytes) : new Uint8Array(0);
  const id    = te.encode(String(aadId || ""));
  const h0 = await sha256(concatU8(tag("ns-sig/v1"), sid, new Uint8Array([0]),
                                 tbytes, new Uint8Array([0]), id, new Uint8Array([0]),
                                 hpkeEnc instanceof Uint8Array ? hpkeEnc : new Uint8Array(0)));
  return { h: h0 };
}

export async function sigAddData(st, seq, ciphertextU8) {
  // Hi+1 = sha256( 0x01 || Hi || u32(seq) || sha256(ciphertext) )
  const cth = await sha256(ciphertextU8);
  st.h = await sha256(concatU8(new Uint8Array([1]), st.h, u32be(seq >>> 0), cth));
}

export async function sigFinalize(st, { frames, bytes }) {
  // Hf = sha256( 0xff || H || u32(frames) || u64(bytes) )
  st.h = await sha256(concatU8(new Uint8Array([0xff]), st.h, u32be(frames >>> 0), u64be(bytes >>> 0)));
  return st.h;
}

// Node helpers ---------------------------------------------------------------

export function createRSAVerifier() {
  return nodeCreateVerify("RSA-SHA256");
}