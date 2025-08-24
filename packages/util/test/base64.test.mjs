import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64, unb64, b64url, b64u, unb64u } from '../src/base64.js';

test('b64/unb64 round trip', () => {
  const data = new Uint8Array([0, 1, 2, 255]);
  const encoded = b64(data);
  assert.deepEqual(unb64(encoded), data);
});

test('b64url output is URL‑safe and decodes', () => {
  const data = new Uint8Array([0xff, 0xee, 0xdd]);
  const encoded = b64url(data);
  assert(!/[+/=]/.test(encoded));
  assert.deepEqual(unb64(encoded), data);
});

test('aliases b64u/unb64u behave as b64url/unb64', () => {
  const data = new Uint8Array([5, 4, 3, 2]);
  const encoded = b64u(data);
  assert.equal(encoded, b64url(data));
  assert.deepEqual(unb64u(encoded), data);
});