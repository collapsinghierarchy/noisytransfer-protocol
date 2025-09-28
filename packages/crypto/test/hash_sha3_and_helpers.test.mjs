import { test } from "node:test";
import assert from "node:assert/strict";
import { sha3_256, constantTimeEqual } from "@noisytransfer/crypto";
import { toHex, fromHex } from "@noisytransfer/util";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

test("sha3_256 produces consistent output", async () => {
  const msg = new TextEncoder().encode("abc");
  const h1 = toHex(await sha3_256(msg));
  const h2 = toHex(await sha3_256(msg));
  assert.equal(h1, h2, "hashes for the same input should match");
});


test("fromHex accepts uppercase and throws on odd length", () => {
  const u = fromHex("DEADBEEF");
  assert.deepEqual(u, new Uint8Array([0xde,0xad,0xbe,0xef]));
  // The implementation throws TypeError('fromHex: odd length')
  assert.throws(() => fromHex("abc"), TypeError);
});

test("constantTimeEqual same length timing behavior (smoke), mismatch returns false", () => {
  const a = new Uint8Array(32).fill(7);
  const b = new Uint8Array(32).fill(7);
  const c = new Uint8Array(32).fill(9);
  assert.equal(constantTimeEqual(a,b), true);
  assert.equal(constantTimeEqual(a,c), false);
});
