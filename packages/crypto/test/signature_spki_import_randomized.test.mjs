import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  signChunk,
  verifyChunk,
  importVerifyKey,
  sha256,
} from '@noisytransfer/crypto';

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

test('RSA-PSS: SPKI export/import roundtrip for verify key', async () => {
  const { privateKey, publicKey } = await genRsaPss();

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  const imported = await importVerifyKey(spki);

  const data = new TextEncoder().encode('hello world');
  const digest = await sha256(data);

  const sig = await signChunk(privateKey, digest);
  assert.equal(await verifyChunk(publicKey, sig, digest), true, 'original key must verify');
  assert.equal(await verifyChunk(imported, sig, digest), true, 'imported key must verify');
});

test('RSA-PSS: signatures are probabilistic (different each time)', async () => {
  const { privateKey } = await genRsaPss();
  const digest = await sha256(new TextEncoder().encode('deterministic message'));

  const s1 = await signChunk(privateKey, digest);
  const s2 = await signChunk(privateKey, digest);

  const equal = s1.length === s2.length && s1.every((b, i) => b === s2[i]);
  assert.equal(equal, false, 'RSA-PSS signatures should differ for the same message');
});
