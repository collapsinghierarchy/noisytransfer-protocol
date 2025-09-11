import { test } from "node:test";
import assert from "node:assert/strict";
import { genRSAPSS, signChunk, verifyChunk, importVerifyKey, sha256 } from "@noisytransfer/crypto";
import {b64u} from "@noisytransfer/util";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

const te = new TextEncoder();

test("RSA-PSS sign/verify happy path and tamper detection", async () => {
  const { signingKey, verificationKey } = await genRSAPSS();
  const verifyKey = await importVerifyKey(verificationKey);
  const data = te.encode("chunk-to-sign");
  const sig = await signChunk(signingKey, data);
  const ok = await verifyChunk(verifyKey, sig, data);

  assert.equal(ok, true);

  const bad = await verifyChunk(verifyKey, te.encode("tampered"), sig);
  assert.equal(bad, false);
});

test("importVerifyKey works with exported SPKI", async () => {
  const { signingKey, verificationKey } = await genRSAPSS();
  const verifyKey = await importVerifyKey(verificationKey);
  const data = te.encode("abc");
  const sig = await signChunk(signingKey, data);
  const ok = await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, verifyKey, sig, data);
  assert.equal(ok, true);
});
