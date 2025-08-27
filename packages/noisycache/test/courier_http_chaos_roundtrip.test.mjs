// test/noisycache/courier_http_chaos_roundtrip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc, randomBytes } from 'node:crypto';

globalThis.crypto ??= wc;

import WebSocket from 'ws';
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

import { HttpStore } from '@noisytransfer/noisycache/http_store';
import { uploadCiphertext } from '@noisytransfer/noisycache/uploader';
import { downloadAndDecrypt } from '@noisytransfer/noisycache/downloader';
import { mailboxTransport as mkMailbox } from '@noisytransfer/transport';
import { suite } from '@noisytransfer/crypto';
import { genRSAPSS } from '@noisytransfer/crypto';
import { runCourierSender, runCourierReceiver, mkSendMsgWithVK } from '@noisytransfer/noisycache';
import { makeEncryptor, makeDecryptor } from "@noisytransfer/crypto";

const asU8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));

export async function makeAeadChunkEncryptorCompat({
  keyBytes, baseIV, aadId, tagBytes = 16, counterStart = 0,
}) {
  const enc = await makeEncryptor(keyBytes, baseIV, tagBytes);
  return {
    aead: "AES-GCM",
    tagBytes,
    counterStart,
    async sealChunk(seq, pt /* aad ignored: bound via aadId */) {
      const idx = (counterStart + (seq >>> 0)) >>> 0;
      return enc.seal(aadId, idx, asU8(pt));
    },
  };
}

export async function makeAeadChunkDecryptorCompat({
  keyBytes, baseIV, aadId, tagBytes = 16, counterStart = 0,
}) {
  const dec = await makeDecryptor(keyBytes, baseIV, tagBytes);
  return {
    aead: "AES-GCM",
    tagBytes,
    counterStart,
    async openChunk(seq, ct /* aad ignored: bound via aadId */) {
      const idx = (counterStart + (seq >>> 0)) >>> 0;
      return dec.open(aadId, idx, asU8(ct));
    },
  };
}

const BASE_WS = process.env.NOISY_WS ?? 'ws://localhost:1234/ws';
const BASE_HTTP = process.env.NOISY_BASE ?? 'http://localhost:1234';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sinkCollector() { const parts=[]; return { write(b){ parts.push(Buffer.from(b)); }, result(){ return Buffer.concat(parts); } }; }

function wrapInboundMute(tx) {
  const locals = new Set();
  const backlog = [];
  let mute = false;
  const un = tx.onMessage((m) => {
    if (mute) { backlog.push(m); return; }
    for (const cb of [...locals]) { try { cb(m); } catch {} }
  });
  return {
    ...tx,
    onMessage(cb){ locals.add(cb); return () => locals.delete(cb); },
    muteIn(){ mute = true; },
    unmuteIn(){
      mute = false;
      while (backlog.length) {
        const m = backlog.shift();
        for (const cb of [...locals]) { try { cb(m); } catch {} }
      }
    },
    _teardown(){ try{un?.();}catch{} locals.clear(); backlog.length = 0; },
  };
}

async function genReceiverKemMaterial() {
  const kp = await suite.kem.generateKeyPair();
  const kemPubBytes = await suite.kem.serializePublicKey(kp.publicKey);
  return { kemPriv: kp.privateKey, kemPubBytes };
}

/* -------------------------------------------------------------------------- */
/* 1) Receiver-first, courier chaos flaps, then parallel HTTP download         */
/* -------------------------------------------------------------------------- */
test('HTTP upload + mailbox courier + parallel download — receiver first, chaos flaps', { timeout: 120_000 }, async () => {
  const store = new HttpStore(BASE_HTTP);

  // plaintext + AEAD (compat with your aead.js)
  const PT = randomBytes(8.5 * 1024 * 1024 | 0);
  const keyBytes = randomBytes(32);
  const baseIV   = randomBytes(12);
  const aadId    = 'chaos-demo'; // stable across enc/dec

  const enc = await makeAeadChunkEncryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });

  // Upload (HTTP)
  const up = await uploadCiphertext({
    storage: store,
    source: PT,
    encryptor: enc,
    chunkBytes: 1 * 1024 * 1024,
    encTag: aadId,
  });

  // Mailbox transports
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const Braw = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const B = wrapInboundMute(Braw); // we will flap the receiver’s inbound

  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // Start receiver first
  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  // short delay then start sender
  await sleep(150);
  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });

  // flap during auth + courier
  const flap = (async () => {
    for (let i = 0; i < 5; i++) {
      B.muteIn();   await sleep(80 + 40 * i);
      B.unmuteIn(); await sleep(70 + 30 * i);
    }
  })();

  // Send courier with key packet params
  const pSend = runCourierSender({
    tx: A, sessionId, sendMsg, signingKey,
    keyPacket: {
      id: up.objectId,
      fk: keyBytes,
      baseIV,
      chunkSize: up.manifest.chunkBytes,
      totalSize: up.manifest.totalBytes,
      chunks: up.manifest.totalChunks,
      hash: up.manifest.cipherDigest,
    },
  });

  const [{ keyPacket }] = await Promise.all([pRecv, pSend, flap]).then(([r]) => [r]);
  assert.ok(keyPacket && keyPacket.id === up.objectId, 'receiver must get matching key packet');

  // Build decryptor from the received key packet
  const dec = await makeAeadChunkDecryptorCompat({
    keyBytes: keyPacket.fk,
    baseIV: keyPacket.baseIV,
    aadId, // must match uploader’s aadId
    tagBytes: 16,
    counterStart: 0,
  });

  // Parallel download with high concurrency (chaotic scheduling inside downloader)
  const sink = sinkCollector();
  const dl = await downloadAndDecrypt({
    storage: store,
    objectId: up.objectId,
    manifest: up.manifest,
    decryptor: dec,
    parallel: 8,
    sink,
  });
  assert.equal(dl.verified, true);

  const got = sink.result();
  assert.equal(got.length, PT.length);
  assert.ok(got.equals(PT), 'plaintext mismatch');

  A.close(); B.close(); B._teardown?.();
});

/* -------------------------------------------------------------------------- */
/* 2) Sender-first, then receiver later; flap BOTH sides; download w/ different parallelism */
/* -------------------------------------------------------------------------- */
test('HTTP upload + mailbox courier + parallel download — sender first, double chaos flaps', { timeout: 120_000 }, async () => {
  const store = new HttpStore(BASE_HTTP);

  const PT = randomBytes(10.1 * 1024 * 1024 | 0);
  const keyBytes = randomBytes(32);
  const baseIV   = randomBytes(12);
  const aadId    = 'chaos-demo-2';

  const enc = await makeAeadChunkEncryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });

  const up = await uploadCiphertext({
    storage: store,
    source: PT,
    encryptor: enc,
    chunkBytes: 1 * 1024 * 1024,
    encTag: aadId,
  });

  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const Araw = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });
  const A = wrapInboundMute(Araw); // we’ll flap sender inbound too (simulates noisy channel / server→client)

  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // Start sender first
  const pSend = runCourierSender({
    tx: A, sessionId, sendMsg, signingKey,
    keyPacket: {
      id: up.objectId,
      fk: keyBytes,
      baseIV,
      chunkSize: up.manifest.chunkBytes,
      totalSize: up.manifest.totalBytes,
      chunks: up.manifest.totalChunks,
      hash: up.manifest.cipherDigest,
    },
  });

  // Delay, then receiver comes online (also flapped)
  await sleep(250);
  const Braw = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const B = wrapInboundMute(Braw);

  // Flap both sides a bit while auth/courier proceeds
  const flap = (async () => {
    for (let i = 0; i < 4; i++) {
      A.muteIn(); await sleep(60 + 30 * i); A.unmuteIn();
      B.muteIn(); await sleep(70 + 35 * i); B.unmuteIn();
    }
  })();

  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  const [{ keyPacket }] = await Promise.all([pRecv, pSend, flap]).then(([r]) => [r]);
  assert.ok(keyPacket && keyPacket.id === up.objectId);

  const dec = await makeAeadChunkDecryptorCompat({
    keyBytes: keyPacket.fk,
    baseIV: keyPacket.baseIV,
    aadId,
    tagBytes: 16,
    counterStart: 0,
  });

  const sink = sinkCollector();
  const dl = await downloadAndDecrypt({
    storage: store,
    objectId: up.objectId,
    manifest: up.manifest,
    decryptor: dec,
    parallel: 5, // different from previous
    sink,
  });
  assert.equal(dl.verified, true);

  const got = sink.result();
  assert.equal(got.length, PT.length);
  assert.ok(got.equals(PT));

  A.close(); B.close(); A._teardown?.(); B._teardown?.();
});

test('HTTP upload + courier — long blob, 768KiB chunks, high parallel, chaos flaps (receiver first)', { timeout: 180_000 }, async () => {
  const store = new HttpStore(BASE_HTTP);

  const PT = randomBytes(32 * 1024 * 1024);   // 32 MiB
  const keyBytes = randomBytes(32);
  const baseIV   = randomBytes(12);
  const aadId    = 'chaos-long-1';

  const enc = await makeAeadChunkEncryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });

  const up = await uploadCiphertext({
    storage: store,
    source: PT,
    encryptor: enc,
    chunkBytes: 768 * 1024, // non power-of-two chunk size
    encTag: aadId,
  });

  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const Braw = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const B = wrapInboundMute(Braw);

  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // Start receiver first
  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  // Later start sender
  await sleep(200);
  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });

  // Aggressive flapping while auth + courier run
  const flap = (async () => {
    for (let i = 0; i < 8; i++) {
      B.muteIn();   await sleep(60 + 25 * i);
      B.unmuteIn(); await sleep(40 + 20 * i);
    }
  })();

  const pSend = runCourierSender({
    tx: A, sessionId, sendMsg, signingKey,
    keyPacket: {
      id: up.objectId,
      fk: keyBytes,
      baseIV,
      chunkSize: up.manifest.chunkBytes,
      totalSize: up.manifest.totalBytes,
      chunks: up.manifest.totalChunks,
      hash: up.manifest.cipherDigest,
    },
  });

  const [{ keyPacket }] = await Promise.all([pRecv, pSend, flap]).then(([r]) => [r]);
  assert.ok(keyPacket && keyPacket.id === up.objectId);

  const dec = await makeAeadChunkDecryptorCompat({ keyBytes: keyPacket.fk, baseIV: keyPacket.baseIV, aadId, tagBytes: 16, counterStart: 0 });

  const sink = sinkCollector();
  const dl = await downloadAndDecrypt({
    storage: store,
    objectId: up.objectId,
    manifest: up.manifest,
    decryptor: dec,
    parallel: 12,   // crank it up
    sink,
  });
  assert.equal(dl.verified, true);
  const got = sink.result();
  assert.equal(got.length, PT.length);
  assert.ok(got.equals(PT));

  A.close(); B.close(); B._teardown?.();
});
