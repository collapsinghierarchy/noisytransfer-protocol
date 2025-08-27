// Streaming encrypt-and-upload for multi-GB files. Storage- and crypto-agnostic.

import { CACHE } from '@noisytransfer/constants';
import { createSHA256, Readable } from '@noisytransfer/crypto';
import { NoisyError } from '@noisytransfer/errors/noisy-error';

import { makeManifest, aadFor } from './manifest.js';


function toAsyncIter(source, chunkBytes) {
  // Supports Buffer/Uint8Array, Blob (web), Readable/ReadableStream, or async iterator
  if (source == null) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing source' });
  // Buffer-ish
  if (typeof source === 'string') source = Buffer.from(source);
  if (source instanceof Uint8Array) {
    return (async function* () {
      let off = 0; const n = source.length;
      while (off < n) { const end = Math.min(off + chunkBytes, n); yield source.subarray(off, end); off = end; }
    })();
  }
  // Node Readable
  if (typeof source.read === 'function' && typeof source.on === 'function') {
    const reader = source; reader.pause?.();
    return (async function* () {
      for await (const chunk of reader) { yield chunk instanceof Uint8Array ? chunk : Buffer.from(chunk); }
    })();
  }
  // Web ReadableStream
  if (typeof source.getReader === 'function') {
    const reader = source.getReader();
    return (async function* () {
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; yield value; }
      } finally { reader.releaseLock?.(); }
    })();
  }
  throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'unsupported source type' });
}

export async function uploadCiphertext({
  storage,                 // HttpStore
  source,                  // Buffer|Readable|ReadableStream|Uint8Array
  encryptor,               // { aead, tagBytes, counterStart?, sealChunk(seq, pt, aad) }
  chunkBytes = 4 * 1024 * 1024,
  abortSignal,
  onProgress,              // (info) => void, where info = { seq, ptBytes, ctBytes, sentBytes }
  signingKey,              // optional CryptoKey (RSA-PSS) or { sign(dataU8)->sigU8 }
  encTag = '',             // SHA-256(enc) (optional)
  context = {},            // extra context fields to include in manifest
}) {
  if (!storage) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing storage' });
  if (!encryptor || typeof encryptor.sealChunk !== 'function') throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing encryptor.sealChunk' });

  // 1) Create object and get URLs
  const created = await storage.create({ signal: abortSignal });
  const { objectId, uploadUrl, manifestUrl } = created;

  // 2) Build a streaming body that encrypts on the fly and hashes ciphertext transcript
  const ptIter = toAsyncIter(source, chunkBytes);
  const sha = createSHA256();

  let totalPt = 0, totalCt = 0, seq = 0;
  let lastChunkPlaintextBytes = 0;

  async function* ctGenerator() {
    for await (const pt of ptIter) {
      const ptU8 = pt instanceof Uint8Array ? pt : Buffer.from(pt);
      lastChunkPlaintextBytes = ptU8.length;
      const aad = aadFor(seq, ptU8.length);
      let ct;
      try {
        ct = await encryptor.sealChunk(seq, ptU8, aad);
      } catch (e) {
        throw new NoisyError({ code: 'NC_ENCRYPT_FAILED', message: 'encrypt chunk failed', context: { seq }, cause: e });
      }
      if (!(ct instanceof Uint8Array)) throw new NoisyError({ code: 'NC_ENCRYPT_FAILED', message: 'encryptor returned non-bytes', context: { seq } });
      sha.update(ct);
      totalPt += ptU8.length;
      totalCt += ct.length;
      if (onProgress) onProgress({ seq, ptBytes: ptU8.length, ctBytes: ct.length, sentBytes: totalCt });
      yield ct;
      seq++;
    }
  }

  const nodeStream = Readable.from(ctGenerator());

  // 3) PUT blob (streamed)
  const { etag } = await storage.putBlob({ uploadUrl, data: nodeStream, signal: abortSignal });

  // 4) Manifest (compute totals from the run)
  const totalChunks = seq; // after loop
  const cipherDigestHex = sha.digest('hex');

  // Optional final signature (RSA-PSS over cipher digest + minimal context)
  let finSignature = '';
  if (signingKey) {
    try {
      const algo = { name: 'RSA-PSS', saltLength: 32 };
      const enc = new TextEncoder();
      const ctxBytes = enc.encode(JSON.stringify({ aead: encryptor.aead, tagBytes: encryptor.tagBytes, chunkBytes, counterStart: encryptor.counterStart || 0 }));
      const preimage = Buffer.concat([ctxBytes, Buffer.from(cipherDigestHex, 'hex')]);
      let sigU8;
      if (typeof signingKey.sign === 'function') {
        sigU8 = await signingKey.sign(preimage);
      } else if (globalThis.crypto?.subtle) {
        sigU8 = new Uint8Array(await crypto.subtle.sign(algo, signingKey, preimage));
      } else {
        throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'No WebCrypto; provide signingKey.sign()' });
      }
      finSignature = Buffer.from(sigU8).toString('base64url');
    } catch (e) {
      throw new NoisyError({ code: 'NC_SIGN_FAILED', message: 'final signature failed', cause: e });
    }
  }

  const manifest = makeManifest({
    aead: encryptor.aead,
    tagBytes: encryptor.tagBytes,
    chunkBytes,
    totalBytes: totalPt,
    totalChunks,
    lastChunkPlaintextBytes,
    counterStart: encryptor.counterStart || 0,
    encTag,
    cipherDigest: cipherDigestHex,
    finSigAlg: CACHE.SIG_ALG,
    finSignature,
    context,
  });

  // 5) PUT manifest, then commit
  await storage.putManifest({ manifestUrl, manifest, signal: abortSignal });
  const meta = await storage.commit({ objectId, signal: abortSignal });

  return { objectId, manifestUrl, uploadUrl, manifest, etag, meta };
}