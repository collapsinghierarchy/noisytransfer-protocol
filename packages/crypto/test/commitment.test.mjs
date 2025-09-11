import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommitment, verifyCommitment, packCommitment, parseCommitment, randomNonce } from "@noisytransfer/crypto";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

const te = new TextEncoder();

test("commitment roundtrip (SHA3-256)", async () => {
  const data = te.encode("hello world");
  const nonce = randomNonce(24);
  const c = await computeCommitment(data, { nonce, hash: "SHA3-256", label: "L" });
  assert.equal(await verifyCommitment({ data, nonce: c.nonce, commitment: c.commitment, hash: c.alg, label: c.label }), true);
});

test("pack/parse roundtrip", async () => {
  const data = te.encode("sample");
  const nonce = randomNonce(24);
  const c = await computeCommitment(data, { nonce, hash: "SHA3-256", label: "X" });
  const packed = packCommitment(c);
  const parsed = parseCommitment(packed);
  assert.equal(parsed.alg, c.alg);
  assert.equal(parsed.label, c.label);
  // Verify using parsed
  assert.equal(await verifyCommitment({ data, ...parsed, commitment: parsed.commitment, hash: parsed.alg, label: parsed.label }), true);
});

test("commitment: algorithm and label affect output", async () => {
  const data = te.encode("hello world");
  const fixedNonce = new Uint8Array(32); // all zeros for determinism
  const c1 = await computeCommitment(data, { nonce: fixedNonce, hash: "SHA3-256", label: "L1" });
  const c2 = await computeCommitment(data, { nonce: fixedNonce, hash: "SHA-256", label: "L1" });
  const c3 = await computeCommitment(data, { nonce: fixedNonce, hash: "SHA3-256", label: "L2" });
  assert.notEqual(c1.commitment, c2.commitment);
  assert.notEqual(c1.commitment, c3.commitment);
  assert.notEqual(c2.commitment, c3.commitment);
});

test("randomNonce validates size", () => {
  assert.throws(() => randomNonce(8), /nonceBytes must be integer >= 16/);
  const n16 = randomNonce(16);
  assert.equal(n16.length, 16);
});
