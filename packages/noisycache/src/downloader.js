// Parallel Range download + per-chunk decrypt + final verification.
import { createSHA256 } from "@noisytransfer/crypto";
import { createRSAVerifier } from "@noisytransfer/crypto";
import { NoisyError } from "@noisytransfer/errors/noisy-error";

import { validateManifest, ctOffsetOfChunk, ctLenOfChunk, aadFor } from "./manifest.js";

export async function downloadAndDecrypt({
  storage, // HttpStore
  objectId,
  manifest, // already fetched, or
  _manifestUrl, // (unused here) fetch manifest externally if needed
  decryptor, // { aead, tagBytes, openChunk(seq, ct, aad) }
  parallel = 6,
  sink, // Node Writable-like: has .write(Buffer) and awaits when returns Promise|false
  verifyKey, // optional: Node KeyObject or crypto.subtle verify key
  expectCipherDigest, // optional hex string to cross-check
  abortSignal,
  onProgress, // (info) => void where info = { seq, ptBytes, ctBytes, writtenBytes }
}) {
  if (!storage) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing storage" });
  if (!objectId) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing objectId" });
  if (!decryptor || typeof decryptor.openChunk !== "function")
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing decryptor.openChunk" });
  if (!manifest)
    throw new NoisyError({
      code: "NC_BAD_PARAM",
      message: "manifest required (fetch it before calling)",
    });

  validateManifest(manifest);
  if (manifest.aead !== decryptor.aead || manifest.tagBytes !== decryptor.tagBytes) {
    throw new NoisyError({
      code: "NC_AEAD_MISMATCH",
      message: "decryptor does not match manifest AEAD/tagBytes",
    });
  }

  const totalChunks = manifest.totalChunks;
  const sha = createSHA256();
  let written = 0;
  // Hold finished chunks until we can process them in-order.
  const slots = new Map(); // seq -> { ct: Uint8Array, pt: Uint8Array }
  let nextSeqToDrain = 0;
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const slot = slots.get(nextSeqToDrain);
        if (!slot) break;
        // 1) hash ciphertext in-order
        sha.update(slot.ct);
        // 2) write plaintext in-order
        if (sink && typeof sink.write === "function") {
          const ret = sink.write(Buffer.from(slot.pt));
          if (ret && typeof ret.then === "function") await ret;
        }
        written += slot.pt.length;
        if (onProgress)
          onProgress({
            seq: nextSeqToDrain,
            ptBytes: slot.pt.length,
            ctBytes: slot.ct.length,
            writtenBytes: written,
          });
        slots.delete(nextSeqToDrain);
        nextSeqToDrain++;
      }
    } finally {
      draining = false;
    }
  }

  // simple worker pool for chunks 0..N-1
  let nextSeq = 0;
  let active = 0;
  let rejectOnce, resolveOnce;
  const doneP = new Promise((res, rej) => {
    resolveOnce = res;
    rejectOnce = rej;
  });

  async function runOne(seq) {
    try {
      const start = ctOffsetOfChunk(seq, manifest);
      const end = start + ctLenOfChunk(seq, manifest) - 1;
      const { bytes: ct, contentRange: _contentRange } = await storage.getRange({
        objectId,
        start,
        end,
        signal: abortSignal,
      });
      if (!ct || ct.length !== end - start + 1) {
        throw new NoisyError({
          code: "NC_RANGE_SIZE",
          message: "range length mismatch",
          context: { seq, start, end, got: ct?.length },
        });
      }
      const ptLen = seq < totalChunks - 1 ? manifest.chunkBytes : manifest.lastChunkPlaintextBytes;
      const aad = aadFor(seq, ptLen);
      let pt;
      try {
        pt = await decryptor.openChunk(seq, ct, aad);
      } catch (e) {
        throw new NoisyError({
          code: "NC_DECRYPT_FAILED",
          message: "decrypt chunk failed",
          context: { seq },
          cause: e,
        });
      }
      if (!(pt instanceof Uint8Array) || pt.length !== ptLen) {
        throw new NoisyError({
          code: "NC_DECRYPT_SIZE",
          message: "plaintext length mismatch",
          context: { seq, expect: ptLen, got: pt?.length },
        });
      }
      // Store and try to drain in-order
      slots.set(seq, { ct, pt });
      // Fire-and-forget; drain serializes writes internally.
      // If it throws, the catch below will capture via rejectOnce.
      drain().catch((e) => rejectOnce?.(e));
    } finally {
      schedule();
    }
  }

  function schedule() {
    if (abortSignal?.aborted) {
      rejectOnce?.(new DOMException("Aborted", "AbortError"));
      return;
    }
    while (active < parallel && nextSeq < totalChunks) {
      const s = nextSeq++;
      active++;
      runOne(s)
        .then(() => {
          active--;
          if (active === 0 && nextSeq >= totalChunks) resolveOnce?.();
          return true; // satisfy promise/always-return
        })
        .catch((e) => {
          active--;
          rejectOnce?.(e);
        });
    }
    if (active === 0 && nextSeq >= totalChunks) resolveOnce?.();
  }

  schedule();
  await doneP;

  // Ensure everything has been drained in order before final hash compare
  await drain();
  if (nextSeqToDrain !== totalChunks || slots.size !== 0) {
    throw new NoisyError({
      code: "NC_INTERNAL_ORDER",
      message: "not all chunks drained in order",
      context: { nextSeqToDrain, totalChunks, pending: slots.size },
    });
  }

  // Verify cipher digest
  const digestHex = sha.digest("hex");
  if (expectCipherDigest && expectCipherDigest !== digestHex) {
    throw new NoisyError({
      code: "NC_HASH_MISMATCH",
      message: "ciphertext digest mismatch",
      context: { expect: expectCipherDigest, got: digestHex },
    });
  }
  if (manifest.cipherDigest && manifest.cipherDigest !== digestHex) {
    throw new NoisyError({
      code: "NC_HASH_MISMATCH",
      message: "manifest cipherDigest mismatch",
      context: { manifest: manifest.cipherDigest, got: digestHex },
    });
  }

  // Optional RSA-PSS verify (if both present)
  if (verifyKey && manifest.finSignature) {
    try {
      const preimage = Buffer.concat([
        Buffer.from(
          JSON.stringify({
            aead: manifest.aead,
            tagBytes: manifest.tagBytes,
            chunkBytes: manifest.chunkBytes,
            counterStart: manifest.counterStart,
          })
        ),
        Buffer.from(digestHex, "hex"),
      ]);
      let ok = false;
      if (verifyKey.type === "spki" || typeof verifyKey.export === "function") {
        // Node KeyObject
        const v = createRSAVerifier();
        v.update(preimage);
        v.end();
        ok = v.verify(verifyKey, Buffer.from(manifest.finSignature, "base64url"));
      } else if (globalThis.crypto?.subtle) {
        ok = await crypto.subtle.verify(
          { name: "RSA-PSS", saltLength: 32 },
          verifyKey,
          Buffer.from(manifest.finSignature, "base64url"),
          preimage
        );
      }
      if (!ok)
        throw new NoisyError({ code: "NC_SIGNATURE_INVALID", message: "verify returned false" });
    } catch (e) {
      throw new NoisyError({
        code: "NC_SIGNATURE_INVALID",
        message: "final signature invalid",
        cause: e,
      });
    }
  }

  return { bytesWritten: written, verified: true };
}
