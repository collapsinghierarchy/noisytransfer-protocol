import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEncryptor,
  makeDecryptor,
  genRSAPSS,
  importVerifyKey,
  signChunk,
  verifyChunk,
} from "@noisytransfer/crypto";
import { webcrypto } from "node:crypto";

// Ensure WebCrypto API is available in Node
globalThis.crypto ??= webcrypto;

const te = new TextEncoder();

test("AES-GCM encrypt/decrypt round trip", async () => {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const baseIV = crypto.getRandomValues(new Uint8Array(12));
  const enc = await makeEncryptor(key, baseIV);
  const dec = await makeDecryptor(key, baseIV);
  const pt = te.encode("secret message");
  const ct = await enc.seal("room", 0, pt);
  const out = await dec.open("room", 0, ct);
  assert.deepEqual(out, pt);
});

test("AES-GCM detects tampering", async () => {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const baseIV = crypto.getRandomValues(new Uint8Array(12));
  const enc = await makeEncryptor(key, baseIV);
  const dec = await makeDecryptor(key, baseIV);
  const pt = te.encode("hello");
  const ct = await enc.seal("id", 1, pt);
  await assert.rejects(() => dec.open("wrong", 1, ct), { code: "NC_AEAD_FAILED" });
});

test("RSA-PSS sign and verify", async () => {
  const { verificationKey, signingKey } = await genRSAPSS();
  const verifyKey = await importVerifyKey(verificationKey);
  const msg = te.encode("sign me");
  const sig = await signChunk(signingKey, msg);
  assert.equal(await verifyChunk(verifyKey, sig, msg), true);
  const other = te.encode("sign me please");
  assert.equal(await verifyChunk(verifyKey, sig, other), false);
});
