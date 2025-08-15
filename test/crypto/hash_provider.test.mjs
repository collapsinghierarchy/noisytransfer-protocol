import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, sha3_256, shake128, toHex, constantTimeEqual } from '../../src/crypto/hash.js';
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

test('hash provider basics', async () => {
  const a = new TextEncoder().encode('abc');
  const h1 = await sha256(a);
  const h2 = await sha3_256(a); // equal to sha3('abc') if noble is present; != sha256 otherwise
  assert.equal(h1.length, 32);
  assert.equal(h2.length, 32);
  const ok = constantTimeEqual(h1, h1);
  assert.ok(ok);
  const xof = await shake128(a, 8);
  assert.equal(xof.length, 8);
  assert.match(toHex(h1), /^[0-9a-f]{64}$/);
});