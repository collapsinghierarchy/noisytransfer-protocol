import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEncryptor, makeDecryptor } from "@noisytransfer/crypto";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

const te = new TextEncoder();

test("AES-GCM encrypt/decrypt round trip", async () => {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const baseIV = crypto.getRandomValues(new Uint8Array(12));
  const enc = await makeEncryptor(key, baseIV);
  const dec = await makeDecryptor(key, baseIV);

  const pt = te.encode("hello");
  const ct = await enc.seal("id", 0, pt);
  const out = await dec.open("id", 0, ct);
  assert.deepEqual(out, pt);
});

test("AES-GCM detects tampering", async () => {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const baseIV = crypto.getRandomValues(new Uint8Array(12));
  const enc = await makeEncryptor(key, baseIV);
  const dec = await makeDecryptor(key, baseIV);

  const pt = te.encode("hello");
  const ct = await enc.seal("id", 0, pt);
  ct[0] ^= 0xff;
  await assert.rejects(() => dec.open("id", 0, ct));
});

test("AES-GCM: non-Uint8 plaintext accepted (ArrayBuffer & string via TE)", async () => {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const baseIV = crypto.getRandomValues(new Uint8Array(12));
  const enc = await makeEncryptor(key, baseIV);
  const dec = await makeDecryptor(key, baseIV);
  const ab = new Uint8Array([1,2,3,4]).buffer;
  const ct = await enc.seal("id", 0, ab);
  const out = await dec.open("id", 0, ct);
  assert.deepEqual(out, new Uint8Array(ab));

  // Encode string explicitly to match implementation expectations
  const ct2 = await enc.seal("id", 1, te.encode("hello"));
  const out2 = await dec.open("id", 1, ct2);
  assert.deepEqual(out2, te.encode("hello"));
});
