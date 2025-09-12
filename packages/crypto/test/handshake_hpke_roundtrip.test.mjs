import { test } from "node:test";
import assert from "node:assert/strict";
import * as Crypto from "@noisytransfer/crypto";
import { webcrypto as nodeCrypto } from "node:crypto";
globalThis.crypto ??= nodeCrypto;

const { suite } = Crypto;

const te = new TextEncoder();
const td = new TextDecoder();


test("HPKE handshake roundtrip: seal/open with AAD", async (t) => {
  if (typeof Crypto.createSenderSession !== "function" || typeof Crypto.createReceiverSession !== "function") {
    t.skip("handshake helpers not exported in this build");
    return;
  }
  const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const pkBytes = await suite.kem.serializePublicKey(publicKey);

  const sender = await Crypto.createSenderSession(pkBytes);
  const receiver = await Crypto.createReceiverSession(sender.enc, privateKey);

  const aad = te.encode("room-123");
  const msg = te.encode("hello over hpke");
  const ct = await sender.seal(msg, aad);
  const pt = await receiver.open(ct, aad);
  assert.deepEqual(pt, msg);
  await assert.rejects(() => receiver.open(ct, te.encode("wrong aad")));
});


test("stream: out-of-order decrypt fails (and recover with fresh receiver)", async () => {
  const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const pk = await suite.kem.serializePublicKey(publicKey);

  const s = await Crypto.mkAeadStreamFromHpke("sender", pk);
  const r1 = await Crypto.mkAeadStreamFromHpke("receiver", s.enc, privateKey);

  const c0 = await s.seal(te.encode("zero"));
  const c1 = await s.seal(te.encode("one"));

  // 1) Out-of-order should reject
  await assert.rejects(() => r1.open(c1));

  // 2) Start a fresh receiver (seq resets to 0) and proceed in order
  const r2 = await Crypto.mkAeadStreamFromHpke("receiver", s.enc, privateKey);
  const p0 = await r2.open(c0);
  const p1 = await r2.open(c1);
  assert.equal(td.decode(p0), "zero");
  assert.equal(td.decode(p1), "one");
});

test("HPKE context serializes parallel seal/open", async () => {
  const kp = await suite.kem.generateKeyPair();
  const pub = await suite.kem.serializePublicKey(kp.publicKey);

  const sender = await Crypto.createSenderSession(pub);
  const recv = await Crypto.createReceiverSession(sender.enc, kp.privateKey);

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const chunks = Array.from({ length: 8 }, (_, i) => enc.encode(`m${i}`));

  // parallel encrypt
  const cts = await Promise.all(chunks.map(c => sender.seal(c)));
  // parallel decrypt (order preserved via internal queue)
  const pts = await Promise.all(cts.map(ct => recv.open(ct)));

  assert.equal(dec.decode(pts[0]), "m0");
  assert.equal(dec.decode(pts.at(-1)), "m7");
  assert.deepEqual(pts.map(b => b.byteLength), chunks.map(b => b.byteLength));
});

test("mkAeadStreamFromHpke uses opts.id verbatim", async () => {
  const kp = await suite.kem.generateKeyPair();
  const pub = await suite.kem.serializePublicKey(kp.publicKey);

  const id = "my/app/stream:v1:xyz";
  const send = await Crypto.mkAeadStreamFromHpke("sender", pub, undefined, { id });
  const recv = await Crypto.mkAeadStreamFromHpke("receiver", send.enc, kp.privateKey, { id });

  assert.equal(send.id, id);
  assert.equal(recv.id, id);

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const ct = await send.seal(enc.encode("alpha"), enc.encode(id)); // use id as AAD for demonstration
  const pt = await recv.open(ct, enc.encode(id));

  assert.equal(dec.decode(pt), "alpha");
});