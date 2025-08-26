import { NoisyError } from '@noisytransfer/errors/noisy-error.js';
import { CRYPTO } from '@noisytransfer/constants';

import { asU8, concat } from '@noisytransfer/util/buffer.js';
import { u32be } from '@noisytransfer/util/serial.js';
import { b64u, unb64u } from '@noisytransfer/util/base64.js';
import { sha256, sha3_256, constantTimeEqual } from './hash.js';

const enc = new TextEncoder();

// Domain separation label; keep stable across versions
const DS_PREFIX = CRYPTO.COMMIT_DS_PREFIX;

/** Select hasher by name; add new algs here */
function getHasher(name = 'SHA3-256') {
  const alg = String(name).toUpperCase();
  if (alg === 'SHA3-256') return sha3_256;     // prefers noble; falls back via hash.js
  if (alg === 'SHA-256')  return sha256;
  throw new NoisyError({ code: 'NC_UNSUPPORTED_ALG', message: `commitment: unsupported hash ${name}` });
}

/** Safe, length-prefixed transcript: DS || LP(label) || LP(data) || LP(nonce) */
function buildTranscript({ label, data, nonce }) {
  const L = enc.encode(label ?? '');
  const D = asU8(data);
  const N = asU8(nonce);
  const segs = [
    enc.encode(DS_PREFIX),
    asU8(u32be(L.byteLength)), L,
    asU8(u32be(D.byteLength)), D,
    asU8(u32be(N.byteLength)), N,
  ];
  return asU8(concat(...segs)); // concat -> ArrayBuffer; normalize to Uint8Array
}

/** Generate cryptographically strong random nonce (default 32 bytes). */
export function randomNonce(nonceBytes = 32) {
  if (!Number.isInteger(nonceBytes) || nonceBytes < 16) {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'nonceBytes must be integer >= 16' });
  }
  const n = new Uint8Array(nonceBytes);
  crypto.getRandomValues(n);
  return n;
}

/**
 * Compute commitment C = H( DS || LP(label) || LP(data) || LP(nonce) )
 * @param {ArrayBufferView|ArrayBuffer} data
 * @param {{ nonce?: ArrayBufferView|ArrayBuffer, nonceBytes?: number, hash?: 'SHA3-256'|'SHA-256', label?: string }} [opts]
 * @returns {Promise<{ commitment: Uint8Array, nonce: Uint8Array, alg: string, label: string }>}
 */
export async function computeCommitment(data, opts = {}) {
  const { nonce, nonceBytes = 32, hash = 'SHA3-256', label = '' } = opts;
  const N = nonce == null ? randomNonce(nonceBytes) : asU8(nonce);
  if (N.byteLength < 16) {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'nonce too short; need >= 16 bytes' });
  }
  const hasher = getHasher(hash);
  const transcript = buildTranscript({ label, data, nonce: N });
  const C = await hasher(transcript);
  return { commitment: C, nonce: N, alg: hash, label };
}

/**
 * Verify commitment matches given data+nonce with the same alg/label.
 * @returns {Promise<boolean>}
 */
export async function verifyCommitment({ data, nonce, commitment, hash = 'SHA3-256', label = '' }) {
  const hasher = getHasher(hash);
  const transcript = buildTranscript({ label, data, nonce });
  const C = await hasher(transcript);
  return constantTimeEqual(C, asU8(commitment));
}

/* ------------------------- Wire helpers (optional) ------------------------- */
/** Pack commitment+nonce to b64url strings for frames */
export function packCommitment({ commitment, nonce, alg = 'SHA3-256', label = '' }) {
  return {
    commitment: b64u(asU8(commitment)),
    nonce: b64u(asU8(nonce)),
    alg,
    label,
  };
}

/** Parse commitment+nonce from b64url strings */
export function parseCommitment(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'parseCommitment: expected object' });
  }
  const commitment = unb64u(obj.commitment);
  const nonce = unb64u(obj.nonce);
  const alg = obj.alg || 'SHA3-256';
  const label = obj.label || '';
  return { commitment, nonce, alg, label };
}
