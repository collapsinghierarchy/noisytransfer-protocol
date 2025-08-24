// test/authcore/authcore_mailbox_integration.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { mailboxTransport as mkMailbox } from "@noisytransfer/transport";
import { createAuthSender } from "@noisytransfer/noisyauth/sender.js";
import { createAuthReceiver } from "@noisytransfer/noisyauth/receiver.js";
import { suite } from "@noisytransfer/crypto";

const BASE_WS = "ws://localhost:1234/ws";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Mute/unmute inbound frames to simulate flaky links (server → client). */
function wrapInboundMute(tx) {
  let mute = false;
  const local = new Set();
  const backlog = [];
  const un = tx.onMessage(m => {
    if (mute) { backlog.push(m); return; }
    [...local].forEach(cb => cb(m));
  });
  return {
    ...tx,
    onMessage(cb){ local.add(cb); return () => local.delete(cb); },
    muteIn(){ mute = true; },
    unmuteIn(){
      mute = false;
      while (backlog.length) { const m = backlog.shift(); [...local].forEach(cb => cb(m)); }
    },
    _teardown(){ try{un?.();}catch{} local.clear(); backlog.length = 0; },
  };
}

/** Produce msg_R (small-ish bytes) for the receiver. Reuse your KEM pubkey as a convenient blob. */
async function genRecvMsg() {
  const kp = await suite.kem.generateKeyPair();
  const kemPub = await suite.kem.serializePublicKey(kp.publicKey); // ArrayBuffer
  return kemPub;
}

/** Produce msg_S for the sender (32 random bytes). */
function genSendMsg() {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

/* -------------------------------------------------------------------------- */
/* 1) Happy path: both online, SAS matches                                     */
/* -------------------------------------------------------------------------- */

test("authcore: mailbox happy path → same SAS", { timeout: 30_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID(); // shared auth session id
  const A = await mkMailbox(BASE_WS, { room, side: "A", sessionId: crypto.randomUUID() });
  const B = await mkMailbox(BASE_WS, { room, side: "B", sessionId: crypto.randomUUID() });

  const recvMsg = await genRecvMsg();
  const sendMsg = genSendMsg();

  let sasA, sasB;

  const pA = new Promise((res, rej) => {
    createAuthSender(A, {
      onSAS: s => { sasA = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, sendMsg });
  });

  const pB = new Promise((res, rej) => {
    createAuthReceiver(B, {
      onSAS: s => { sasB = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, recvMsg });
  });

  await Promise.all([pA, pB]);
  assert.ok(sasA && sasB, "SAS digits missing");
  assert.equal(sasA, sasB, "SAS mismatch");

  A.close(); B.close();
});

/* -------------------------------------------------------------------------- */
/* 2) Async start: receiver first, sender later                                */
/* -------------------------------------------------------------------------- */

test("authcore: async start → receiver first, sender later", { timeout: 30_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID(); // shared auth session id
  const Braw = await mkMailbox(BASE_WS, { room, side: "B", sessionId: crypto.randomUUID() });
  const recvMsg = await genRecvMsg();

  let sasB;
  const pB = new Promise((res, rej) => {
    createAuthReceiver(Braw, {
      onSAS: s => { sasB = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, recvMsg });
  });

  await sleep(200);

  const Araw = await mkMailbox(BASE_WS, { room, side: "A", sessionId: crypto.randomUUID() });
  const sendMsg = genSendMsg();

  let sasA;
  const pA = new Promise((res, rej) => {
    createAuthSender(Araw, {
      onSAS: s => { sasA = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, sendMsg });
  });

  await Promise.all([pA, pB]);
  assert.equal(sasA, sasB);

  Araw.close(); Braw.close();
});

/* -------------------------------------------------------------------------- */
/* 3) Chaos: receiver inbound flaps; SAS still completes                       */
/* -------------------------------------------------------------------------- */

test("authcore: chaos flaps → SAS still completes", { timeout: 40_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID(); // shared auth session id
  const Braw = await mkMailbox(BASE_WS, { room, side: "B", sessionId: crypto.randomUUID() });
  const B = wrapInboundMute(Braw);
  const recvMsg = await genRecvMsg();

  let sasB;
  const pB = new Promise((res, rej) => {
    createAuthReceiver(B, {
      onSAS: s => { sasB = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, recvMsg });
  });

  await sleep(150);

  const Araw = await mkMailbox(BASE_WS, { room, side: "A", sessionId: crypto.randomUUID() });
  const sendMsg = genSendMsg();

  let sasA;
  const pA = new Promise((res, rej) => {
    createAuthSender(Araw, {
      onSAS: s => { sasA = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "ws_async", sessionId, roomId: room, sendMsg });
  });

  // Flap receiver inbound 5×
  for (let i = 0; i < 5; i++) {
    B.muteIn();      await sleep(200 + i * 40);
    B.unmuteIn();    await sleep(120 + i * 30);
  }

  await Promise.all([pA, pB]);
  assert.equal(sasA, sasB);

  Araw.close(); Braw.close(); B._teardown?.();
});
