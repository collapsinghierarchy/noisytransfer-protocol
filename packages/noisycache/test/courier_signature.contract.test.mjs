// packages/noisycache/test/courier_signature.contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Polyfill WebCrypto for Node tests ---
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// -----------------------------------------

import { importVerifyKey, verifyChunk } from '@noisytransfer/crypto';

const { subtle } = globalThis.crypto;
const te = new TextEncoder();

test('courier signature is over PLAINTEXT key-packet (not ciphertext)', async () => {
  // 1) Fake plaintext key-packet bytes
  const pt = te.encode('keypacket:unit-test');

  // 2) Generate RSA-PSS keypair (matches library: RSA-PSS + SHA-256)
  const keyPair = await subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  // 3) Import verify key via library
  const spki = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey));
  const verifyKey = await importVerifyKey(spki);

  // 4) Sign the PLAINTEXT (what the sender does)
  const sig = new Uint8Array(
    await subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, keyPair.privateKey, pt)
  );

  // 5) Positive: signature verifies over PLAINTEXT
  assert.equal(await verifyChunk(verifyKey, sig, pt), true);

  // 6) Negative: verify same signature over altered bytes (stand-in for ciphertext)
  const ct = new Uint8Array(pt);
  ct[0] ^= 0xff;
  assert.equal(await verifyChunk(verifyKey, sig, ct), false);
});
