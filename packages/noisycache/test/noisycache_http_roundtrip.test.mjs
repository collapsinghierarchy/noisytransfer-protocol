import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc } from 'node:crypto';

globalThis.crypto ??= wc; // ensure WebCrypto

import { HttpStore } from '@noisytransfer/noisycache/http_store';
import { uploadCiphertext } from '@noisytransfer/noisycache/uploader';
import { downloadAndDecrypt } from '@noisytransfer/noisycache/downloader';
import { makeEncryptor, makeDecryptor } from "@noisytransfer/crypto";

const asU8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));

export async function makeAeadChunkEncryptorCompat({
  keyBytes, baseIV, aadId, tagBytes = 16, counterStart = 0,
}) {
  const enc = await makeEncryptor(keyBytes, baseIV, tagBytes);
  return {
    aead: "AES-GCM",
    tagBytes,
    counterStart,
    async sealChunk(seq, pt /* aad ignored: bound via aadId */) {
      const idx = (counterStart + (seq >>> 0)) >>> 0;
      return enc.seal(aadId, idx, asU8(pt));
    },
  };
}

export async function makeAeadChunkDecryptorCompat({
  keyBytes, baseIV, aadId, tagBytes = 16, counterStart = 0,
}) {
  const dec = await makeDecryptor(keyBytes, baseIV, tagBytes);
  return {
    aead: "AES-GCM",
    tagBytes,
    counterStart,
    async openChunk(seq, ct /* aad ignored: bound via aadId */) {
      const idx = (counterStart + (seq >>> 0)) >>> 0;
      return dec.open(aadId, idx, asU8(ct));
    },
  };
}

const BASE = process.env.NOISY_BASE ?? 'http://localhost:1234';

function sinkCollector() {
  const parts = [];
  return { write(b) { parts.push(Buffer.from(b)); }, result() { return Buffer.concat(parts); } };
}

// --- helpers ---
function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i=0;i<n;i++) u[i] = (Math.random()*256)|0;
  return u;
}

test('aead.js compat: upload→commit→download roundtrip', { timeout: 90_000 }, async () => {
  const store = new HttpStore(BASE);
  const PT = randomBytes(6.3 * 1024 * 1024 | 0);

  // Random CEK and 12-byte baseIV, as your aead.js expects
  const keyBytes = randomBytes(32);
  const baseIV   = randomBytes(12);
  const aadId    = 'demo-stream'; // could be encTag or objectId

  const encryptor = await makeAeadChunkEncryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });
  const decryptor = await makeAeadChunkDecryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });

  const up = await uploadCiphertext({ storage: store, source: PT, encryptor, chunkBytes: 1*1024*1024, encTag: aadId });
  assert.ok(up.objectId);

  const sink = sinkCollector();
  const dl = await downloadAndDecrypt({ storage: store, objectId: up.objectId, manifest: up.manifest, decryptor, parallel: 4, sink });
  assert.equal(dl.verified, true);

  const got = sink.result();
  assert.equal(got.length, PT.length);
  assert.ok(got.equals(PT));
});