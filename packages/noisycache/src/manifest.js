// Helpers for manifest math + validation.

import { CACHE } from '@noisytransfer/constants';
import { NoisyError } from '@noisytransfer/errors/noisy-error';


export function be32(n) {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, n >>> 0, false);
  return b;
}

export function aadFor(seq, ptLen) {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, seq >>> 0, false);
  dv.setUint32(4, ptLen >>> 0, false);
  return out;
}

export function assertNumber(n, name) {
  if (!Number.isFinite(n) || n < 0) {
    throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: `Invalid ${name}: ${n}` });
  }
}

export function validateManifest(m) {
  const req = ['version','aead','tagBytes','chunkBytes','totalBytes','totalChunks','lastChunkPlaintextBytes','counterStart'];
  for (const k of req) if (!(k in m)) throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: `Missing ${k}` });
  if (m.version !== 1) throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: `Unsupported version ${m.version}` });
  if (m.aead !== 'AES-GCM') throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: `Unsupported AEAD ${m.aead}` });
  assertNumber(m.tagBytes, 'tagBytes');
  assertNumber(m.chunkBytes, 'chunkBytes');
  assertNumber(m.totalBytes, 'totalBytes');
  assertNumber(m.totalChunks, 'totalChunks');
  assertNumber(m.lastChunkPlaintextBytes, 'lastChunkPlaintextBytes');
  if (m.totalChunks === 0 && m.totalBytes !== 0) throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: 'totalChunks=0 but totalBytes>0' });
  if (m.totalChunks > 0 && (m.lastChunkPlaintextBytes <= 0 || m.lastChunkPlaintextBytes > m.chunkBytes)) {
    throw new NoisyError({ code: 'NC_BAD_MANIFEST', message: 'lastChunkPlaintextBytes out of range' });
  }
}

// Ciphertext size of chunk i (0-based)
export function ctLenOfChunk(i, m) {
  if (i < m.totalChunks - 1) return m.chunkBytes + m.tagBytes;
  return (m.totalChunks === 0 ? 0 : m.lastChunkPlaintextBytes + m.tagBytes);
}

export function ctTotalBytes(m) {
  if (m.totalChunks === 0) return 0;
  return (m.totalChunks - 1) * (m.chunkBytes + m.tagBytes) + (m.lastChunkPlaintextBytes + m.tagBytes);
}

export function ctOffsetOfChunk(i, m) {
  if (i <= 0) return 0;
  return i * (m.chunkBytes + m.tagBytes);
}

export function makeManifest({ aead = 'AES-GCM', tagBytes = 16, chunkBytes, totalBytes, counterStart = 0, context = {}, encTag = '', cipherDigest = '', finSigAlg = CACHE.SIG_ALG, finSignature = '' }) {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'chunkBytes must be positive int' });
  if (!Number.isInteger(totalBytes) || totalBytes < 0) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'totalBytes must be >= 0' });
  const totalChunks = totalBytes === 0 ? 0 : Math.ceil(totalBytes / chunkBytes);
  const lastChunkPlaintextBytes = totalBytes === 0 ? 0 : (totalBytes - (totalChunks - 1) * chunkBytes);
  const m = { version: 1, aead, tagBytes, chunkBytes, totalBytes, totalChunks, lastChunkPlaintextBytes, counterStart, encTag, cipherDigest, finSigAlg, finSignature, context: { aead, ...context, chunkBytes, counterStart } };
  validateManifest(m);
  return m;
}