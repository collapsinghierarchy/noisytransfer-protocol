import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  importVerifyKey,
  verifyChunk,
  sha256,
} from '@noisytransfer/crypto';

test('importVerifyKey rejects clearly invalid SPKI data', async () => {
  const bad = new Uint8Array([1,2,3,4,5,6,7,8]);
  let threw = false;
  try {
    await importVerifyKey(bad);
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true, 'importVerifyKey should throw on invalid SPKI bytes');
});

test('verifyChunk with non-RSA-PSS key must not succeed', async () => {
  const ecdsa = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const data = new TextEncoder().encode('algo mismatch');
  const digest = await sha256(data);

  let outcome = 'threw';
  try {
    const ok = await verifyChunk(ecdsa.publicKey, new Uint8Array([0x01]), digest);
    outcome = ok ? 'true' : 'false';
  } catch {
    outcome = 'threw';
  }
  assert.notEqual(outcome, 'true', 'verify should not succeed with non-RSA-PSS key');
});
