import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, shake128, toHex, fromHex, constantTimeEqual, createSHA256, Readable } from "@noisytransfer/crypto";
import { webcrypto, createHash } from "node:crypto";
globalThis.crypto ??= webcrypto;

function randBytes(n) {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

test("toHex/fromHex roundtrip and lowercase", async () => {
  const u = randBytes(32);
  const hex = toHex(u);
  assert.match(hex, /^[0-9a-f]+$/);
  const back = fromHex(hex);
  assert.deepEqual(back, u);
});

test("constantTimeEqual detects inequality and length mismatch", async () => {
  const a = new Uint8Array([1,2,3,4]);
  const b = new Uint8Array([1,2,3,5]);
  const c = new Uint8Array([1,2,3,4,5]);
  assert.equal(constantTimeEqual(a, b), false);
  assert.equal(constantTimeEqual(a, c), false);
  assert.equal(constantTimeEqual(a, a), true);
});

test("shake128 determinism and variable length", async () => {
  const msg = new TextEncoder().encode("deterministic xof");
  const x1 = await shake128(msg, 24);
  const x2 = await shake128(msg, 24);
  const x8 = await shake128(msg, 8);
  assert.equal(x1.length, 24);
  assert.equal(x8.length, 8);
  assert.deepEqual(x1, x2); // same input -> same output
  assert.notDeepEqual(x1, x8); // different lengths -> different buffer
});

test("node createHash(sha256) matches WebCrypto sha256()", async () => {
  const msg = new TextEncoder().encode("abc");
  const w = await sha256(msg);
  const n = createHash("sha256").update(Buffer.from(msg)).digest();
  assert.deepEqual(w, new Uint8Array(n));
});

test("Readable is exported and can pipe through Node hashing", async () => {
  const r = new Readable({
    read(size) {
      this.push(Buffer.from("stream-data"));
      this.push(null);
    }
  });
  const chunks = [];
  for await (const c of r) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const n = createSHA256().update(buf).digest();
  const w = await sha256(buf);
  assert.deepEqual(new Uint8Array(n), w);
});
