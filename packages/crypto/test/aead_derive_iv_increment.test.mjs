import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveIv } from "@noisytransfer/crypto";

test("deriveIv increments last 4 bytes big-endian and preserves prefix", () => {
  const base = new Uint8Array([
    0,1,2,3, 4,5,6,7,  0,0,0,1
  ]);
  const iv0 = deriveIv(base, 0);
  const iv5 = deriveIv(base, 5);
  const ivMax = deriveIv(base, 0xffffffff);

  // prefix unchanged
  for (let i=0;i<8;i++) {
    assert.equal(iv0[i], base[i]);
    assert.equal(iv5[i], base[i]);
  }
  // BE addition
  assert.deepEqual(Array.from(iv0.slice(8)), [0,0,0,1]);
  assert.deepEqual(Array.from(iv5.slice(8)), [0,0,0,6]);
  // 1 + 0xffffffff (mod 2^32) -> 0
  assert.deepEqual(Array.from(ivMax.slice(8)), [0,0,0,0]);
});
