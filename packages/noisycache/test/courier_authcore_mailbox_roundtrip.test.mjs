// test/noisycache/courier_authcore_mailbox_roundtrip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc } from 'node:crypto';

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

function sinkCollector() {
  const parts = [];
  return { write(b){ parts.push(Buffer.from(b)); }, result(){ return Buffer.concat(parts); } };
}

// Helpers
function randomBytes(n) {
    const u = new Uint8Array(n);
    for (let i=0;i<n;i++) u[i] = (Math.random()*256)|0;
    return u;
}

async function genReceiverKemMaterial() {
  const kp = await suite.kem.generateKeyPair();
  const kemPubBytes = await suite.kem.serializePublicKey(kp.publicKey);
  return { kemPriv: kp.privateKey, kemPubBytes };
}

test('courier over mailbox authcore: upload → courier (signed) → download', { timeout: 90_000 }, async () => {
  const store = new HttpStore(BASE_HTTP);

  // data & AEAD
  const PT = randomBytes(5.2 * 1024 * 1024 | 0);
  const keyBytes = randomBytes(32);
  const baseIV   = randomBytes(12);
  const aadId    = 'demo-stream';
  const enc = await makeAeadChunkEncryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });
  const dec = await makeAeadChunkDecryptorCompat({ keyBytes, baseIV, aadId, tagBytes: 16, counterStart: 0 });

  // upload
  const up = await uploadCiphertext({
    storage: store,
    source: PT,
    encryptor: enc,
    chunkBytes: 1 * 1024 * 1024,
    encTag: aadId,
  });

  // mailbox
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });
  const B = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });

  // sender signing material + sendMsg containing VK
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // receiver kem
  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();

  // start courier
  const pRecv = runCourierReceiver({
    tx: B,
    sessionId,
    recvMsg: kemPubBytes,
    recipientPrivateKey: kemPriv,
  });

  const pSend = runCourierSender({
    tx: A,
    sessionId,
    sendMsg,
    signingKey,
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

  const { keyPacket } = await Promise.all([pRecv, pSend]).then(([r]) => r);
  assert.ok(keyPacket, 'receiver did not get key packet');
  assert.equal(keyPacket.id, up.objectId);

  // download
  const sink = sinkCollector();
  await downloadAndDecrypt({
    storage: store,
    objectId: up.objectId,
    manifest: up.manifest,
    decryptor: dec, // in real use derive from keyPacket
    parallel: 6,
    sink,
  });
  const got = sink.result();
  assert.equal(got.length, PT.length);
  assert.ok(got.equals(PT));

  A.close(); B.close();
});
