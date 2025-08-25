// test/noisycache/courier_async_variants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc, randomBytes } from 'node:crypto';

globalThis.crypto ??= wc;

import WebSocket from 'ws';
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

import { mailboxTransport as mkMailbox } from '@noisytransfer/transport';
import { suite } from '@noisytransfer/crypto';
import { genRSAPSS } from '@noisytransfer/crypto';
import { runCourierSender, runCourierReceiver, mkSendMsgWithVK } from '@noisytransfer/noisycache';

const BASE_WS = process.env.NOISY_WS ?? 'ws://localhost:1234/ws';

async function genReceiverKemMaterial() {
  const kp = await suite.kem.generateKeyPair();
  const kemPubBytes = await suite.kem.serializePublicKey(kp.publicKey);
  return { kemPriv: kp.privateKey, kemPubBytes };
}

function makeKeyPacketParams({ objectId }) {
  const fk = randomBytes(32);
  const baseIV = randomBytes(12);
  const chunkSize = 1 * 1024 * 1024;
  const totalSize = 3.5 * 1024 * 1024 | 0;
  const chunks = Math.ceil(totalSize / chunkSize);
  const hash = Buffer.from(randomBytes(32)).toString('hex'); // just a placeholder for the test
  return { id: objectId, fk, baseIV, chunkSize, totalSize, chunks, hash };
}

// tiny helper to delay
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Wrap a mailbox transport so we can mute/unmute inbound delivery to our test listeners. */
function wrapInboundMute(tx) {
  const local = new Set();
  const backlog = [];
  let mute = false;

  const un = tx.onMessage((m) => {
    if (mute) { backlog.push(m); return; }
    for (const cb of [...local]) { try { cb(m); } catch {} }
  });

  return {
    ...tx,
    onMessage(cb) { local.add(cb); return () => local.delete(cb); },
    muteIn() { mute = true; },
    unmuteIn() {
      mute = false;
      while (backlog.length) {
        const m = backlog.shift();
        for (const cb of [...local]) { try { cb(m); } catch {} }
      }
    },
    _teardown(){ try { un?.(); } catch {} local.clear(); backlog.length = 0; },
  };
}

/* -------------------------------------------------------------------------- */
/* 1) Receiver starts first; sender later                                      */
/* -------------------------------------------------------------------------- */

test('courier: receiver first, sender later (async start)', { timeout: 60_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const B = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();

  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // start receiver (waits for courier frame)
  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  await sleep(150);

  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });
  const keyPacket = makeKeyPacketParams({ objectId: crypto.randomUUID() });
  const pSend = runCourierSender({ tx: A, sessionId, sendMsg, signingKey, keyPacket });

  const { keyPacket: got } = await Promise.all([pRecv, pSend]).then(([r]) => r);
  assert.ok(got && got.id === keyPacket.id);

  A.close(); B.close();
});

/* -------------------------------------------------------------------------- */
/* 2) Sender starts first; receiver later                                      */
/* -------------------------------------------------------------------------- */

test('courier: sender first, receiver later (async start)', { timeout: 60_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });
  const keyPacket = makeKeyPacketParams({ objectId: crypto.randomUUID() });
  const pSend = runCourierSender({ tx: A, sessionId, sendMsg, signingKey, keyPacket });

  await sleep(250);

  const B = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  const { keyPacket: got } = await Promise.all([pRecv, pSend]).then(([r]) => r);
  assert.ok(got && got.id === keyPacket.id);

  A.close(); B.close();
});

/* -------------------------------------------------------------------------- */
/* 3) Chaos flaps: receiver inbound mutes/unmutes while courier runs           */
/* -------------------------------------------------------------------------- */

test('courier: chaos flaps (receiver inbound mutes/unmutes)', { timeout: 90_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const Braw = await mkMailbox(BASE_WS, { room, side: 'B', sessionId: crypto.randomUUID() });
  const B = wrapInboundMute(Braw);

  const { kemPriv, kemPubBytes } = await genReceiverKemMaterial();
  const { verificationKey, signingKey } = await genRSAPSS();
  const sendMsg = mkSendMsgWithVK(verificationKey);

  // start receiver
  const pRecv = runCourierReceiver({ tx: B, sessionId, recvMsg: kemPubBytes, recipientPrivateKey: kemPriv });

  await sleep(120);

  // start sender
  const A = await mkMailbox(BASE_WS, { room, side: 'A', sessionId: crypto.randomUUID() });
  const keyPacket = makeKeyPacketParams({ objectId: crypto.randomUUID() });
  const pSend = runCourierSender({ tx: A, sessionId, sendMsg, signingKey, keyPacket });

  // flap receiver inbound 4×
  for (let i = 0; i < 4; i++) {
    B.muteIn();   await sleep(120 + 30 * i);
    B.unmuteIn(); await sleep(80 +  25 * i);
  }

  const { keyPacket: got } = await Promise.all([pRecv, pSend]).then(([r]) => r);
  assert.ok(got && got.id === keyPacket.id);

  A.close(); B.close(); B._teardown?.();
});
