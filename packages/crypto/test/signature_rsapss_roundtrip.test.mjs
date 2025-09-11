import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  signChunk,
  verifyChunk,
  sha256,
} from '@noisytransfer/crypto';

function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (Math.random() * 256) | 0;
  return u;
}

async function genRsaPss() {
  return await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 3072,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
}

test('RSA-PSS: sign/verify happy path over message digest', async () => {
  const { privateKey, publicKey } = await genRsaPss();
  const msg = randomBytes(256 * 1024);
  const digest = await sha256(msg);
  const sigAny = await signChunk(privateKey, digest);
  // Accept ArrayBuffer or Uint8Array; normalize
  const sig = sigAny instanceof Uint8Array ? sigAny : new Uint8Array(sigAny);
  assert.ok(sig.byteLength > 0, 'signature must be non-empty');

  const ok = await verifyChunk(publicKey, sig, digest);
  assert.equal(ok, true, 'signature must verify');
});
