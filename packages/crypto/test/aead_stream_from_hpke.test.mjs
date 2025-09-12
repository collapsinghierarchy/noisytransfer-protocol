import { test } from "node:test";
import assert from "node:assert/strict";
import * as Crypto from "@noisytransfer/crypto";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

const { suite, mkAeadStreamFromHpke } = Crypto;
const te = new TextEncoder();

test("mkAeadStreamFromHpke end-to-end streaming", async (t) => {
  const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const pkBytes = await suite.kem.serializePublicKey(publicKey);

  // Try to start a sender stream. If the build has no exporter, skip gracefully.
  let senderStream = await mkAeadStreamFromHpke("sender", pkBytes);
  const receiverStream = await mkAeadStreamFromHpke("receiver", senderStream.enc, privateKey);

  console.log("Stream IDs:", senderStream.id, receiverStream.id);
  assert.equal(senderStream.id, receiverStream.id);
  const chunks = ["alpha", "beta", "gamma"].map((s) => te.encode(s));
  const sealed = await Promise.all(chunks.map((c) => senderStream.seal(c)));
  for (let i = 0; i < sealed.length; i++) {
    const out = await receiverStream.open(sealed[i]);
    console.log("chunk", i, ":", new TextDecoder().decode(out));
    assert.deepEqual(out, chunks[i]);
  }
});
