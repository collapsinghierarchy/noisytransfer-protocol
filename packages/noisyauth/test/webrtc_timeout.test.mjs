// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && (err.stack || err));
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[unhandledRejection]', reason, p);
});

console.log("Test file loaded");

import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
globalThis.RTCPeerConnection     ??= wrtc.RTCPeerConnection;
globalThis.RTCIceCandidate       ??= wrtc.RTCIceCandidate;
globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;

import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { browserWSWithReconnect, rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { suite } from "@noisytransfer/crypto";

const isBun = typeof globalThis.Bun !== "undefined";

/* ---------- signaling ---------- */
async function makeSignal(room, side) {
  const url = `ws://localhost:1234/ws?appID=${room}&side=${side}`;
  const wsTx = browserWSWithReconnect(url, { maxRetries: 0, wsConstructor: WebSocket });

  const outQ = [];
  const flush = () => {
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try { wsTx.send(m); } catch { outQ.unshift(m); break; }
    }
  };
  const unUp = wsTx.onUp(flush);

  return {
    send: m => { if (wsTx.isConnected) wsTx.send(m); else outQ.push(m); },
    close: (...a) => { try { unUp?.(); } catch {} return wsTx.close(...a); },
    onMessage: cb => wsTx.onMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "offer": case "answer": case "ice": cb(msg); break;
        default: /* ignore */ ;
      }
    }),
    onClose: cb => wsTx.onClose(cb),
  };
}

/* ---------- rtc dial ---------- */
async function dial(role, signal, rtcCfg = {}) {
  return role === "initiator" ? rtcInitiator(signal, rtcCfg) : rtcResponder(signal, rtcCfg);
}

/* ---------- helpers ---------- */
async function genReceiverMsg() {
  const kp = await suite.kem.generateKeyPair();
  return await suite.kem.serializePublicKey(kp.publicKey);
}
async function genSenderVerifyKey() {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["sign","verify"]
  );
  return crypto.subtle.exportKey("spki", publicKey);
}
async function closeTx(tx) {
  if (!tx?.close) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; try { un?.(); } catch {} resolve(); } };
    const un = tx.onClose?.(() => finish());
    try {
      const ret = tx.close();
      if (ret && typeof ret.then === "function") ret.then(finish).catch(() => finish());
    } catch { finish(); }
    setTimeout(finish, 200);
  });
}
async function cleanDown(rawA, rawB, sigA, sigB) {
  console.log("Cleaning up connections...");
  await Promise.all([closeTx(rawA), closeTx(rawB), closeTx(sigA), closeTx(sigB)]);
  console.log("Cleanup complete.");
}

/** Drop the *first* outbound send (sender's auth "offer") and pass-through everything else. */
function dropFirstOutbound(tx) {
  const origSend = tx.send.bind(tx);
  let dropped = false;
  const wrapper = Object.create(tx); // preserve live getters/methods
  Object.defineProperty(wrapper, "send", {
    enumerable: true,
    value: (m) => {
      if (!dropped) { dropped = true; return; } // drop first frame
      origSend(m);
    },
  });
  return wrapper;
}

/* ---------- wrapped suite ---------- */

let lastRawA0, lastRawB, lastSigA, lastSigB;

test("webrtc timeout suite (isolated)", { timeout: 30000, skip: isBun && "wrtc not supported by Bun yet" }, async (t) => {
  console.log("Test started: webrtc timeout suite");
  await t.test("authcore-rtc: timeout_wait_offer (receiver)", async () => {
    const room = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
    const [rawA0, rawB] = await Promise.all([
      dial("initiator", sigA, { iceServers: [] }),
      dial("responder", sigB, { iceServers: [] }),
    ]);

    // Save for global cleanup
    lastRawA0 = rawA0; lastRawB = rawB; lastSigA = sigA; lastSigB = sigB;

    const rawA = dropFirstOutbound(rawA0);

    const recvMsg = await genReceiverMsg();
    const sendMsg = await genSenderVerifyKey();

    let sawErr;
    const done = Promise.all([
      new Promise((res) => {
        try {
          createAuthSender(rawA, {
            waitConfirm: () => true,
            onError: (e) => { console.error("Sender onError", e); res(); },
            onDone: () => { console.log("Sender onDone"); res(); },
          }, { policy: "rtc", sessionId, sendMsg });
        } catch (err) {
          console.error("Sender createAuthSender error", err);
          res();
        }
      }),
      new Promise((res) => {
        try {
          createAuthReceiver(rawB, {
            waitConfirm: () => true,
            onError: (e) => { 
              console.error("Receiver onError", e); 
              sawErr = e; 
              res(); 
            },
            onDone: () => { 
              try { 
                throw new Error("receiver must not complete"); 
              } catch (err) { 
                console.error("Receiver onDone error", err); 
              }
            },
          }, { policy: "rtc", sessionId, recvMsg });
        } catch (err) {
          console.error("Receiver createAuthReceiver error", err);
          res();
        }
      }),
    ]);

    try {
      await done;
      assert.ok(sawErr, "expected receiver error");
      assert.match(String(sawErr.code || sawErr), /timeout_wait_offer|timeout/i);
      console.log("Test finished: authcore-rtc: timeout_wait_offer (receiver)");
    } finally {
      await cleanDown(rawA0, rawB, sigA, sigB);
    }
  });
});