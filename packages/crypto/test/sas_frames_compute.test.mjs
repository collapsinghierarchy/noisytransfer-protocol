import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSASFromFrames } from "@noisytransfer/crypto";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

const te = new TextEncoder();

function b64u(u8) {
  const b64 = Buffer.from(u8).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
  return b64;
}

test("computeSASFromFrames: determinism and digits", async () => {
  const offer = { offer: { msgS: b64u(Uint8Array.from([1,2,3])), nonceS: b64u(Uint8Array.from([4,5])) } };
  const reveal = { reveal: { msgR: b64u(Uint8Array.from([6,7,8])), nonceR: b64u(Uint8Array.from([9,10])) } };
  const commit = { commit: { commitment: "c123" } };
  const args = { roomId: "room-1", sessionId: "sess-1", commit, offer, reveal, digits: 6 };
  const a = await computeSASFromFrames(args);
  const b = await computeSASFromFrames(args);
  assert.equal(a.sas.length, 6);
  assert.match(a.sas, /^\d{6}$/);
  assert.deepEqual(a, b);
});

test("computeSASFromFrames: input changes produce different SAS", async () => {
  const offer = { offer: { msgS: b64u(Uint8Array.from([1,2,3])), nonceS: b64u(Uint8Array.from([4,5])) } };
  const reveal = { reveal: { msgR: b64u(Uint8Array.from([6,7,8])), nonceR: b64u(Uint8Array.from([9,10])) } };
  const commit = { commit: { commitment: "c123" } };
  const args = { roomId: "room-1", sessionId: "sess-1", commit, offer, reveal, digits: 6 };
  const a = await computeSASFromFrames(args);
  const args2 = { ...args, sessionId: "sess-2" };
  const b = await computeSASFromFrames(args2);
  assert.notEqual(a.sas, b.sas);
});

test("computeSASFromFrames: validation errors on missing fields", async () => {
  const offer = { offer: { /* missing */ } };
  const reveal = { reveal: { msgR: "AA", nonceR: "AA" } };
  const commit = { commit: { commitment: "c123" } };
  await assert.rejects(() => computeSASFromFrames({ roomId: "r", sessionId: "s", commit, offer, reveal }), { code: "NC_BAD_PARAM" });
});
