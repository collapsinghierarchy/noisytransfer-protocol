// test/crypto/commitment.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommitment, verifyCommitment, packCommitment, parseCommitment, randomNonce } from '../../src/crypto/commitment.js';
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

test('commitment roundtrip (SHA3-256)', async () => {
  const data = new TextEncoder().encode('hello');
  const { commitment, nonce, alg, label } = await computeCommitment(data, { hash: 'SHA3-256', nonceBytes: 24 });
  assert.equal(alg, 'SHA3-256');
  assert.ok(nonce.byteLength === 24);
  assert.equal(await verifyCommitment({ data, nonce, commitment, hash: alg, label }), true);

  // Wire helpers
  const packed = packCommitment({ commitment, nonce, alg, label });
  const parsed = parseCommitment(packed);
  assert.equal(await verifyCommitment({ data, nonce: parsed.nonce, commitment: parsed.commitment, hash: parsed.alg, label: parsed.label }), true);
});

test('commitment rejects wrong data', async () => {
  const a = new TextEncoder().encode('A');
  const b = new TextEncoder().encode('B');
  const { commitment, nonce } = await computeCommitment(a, {});
  assert.equal(await verifyCommitment({ data: b, nonce, commitment }), false);
});
