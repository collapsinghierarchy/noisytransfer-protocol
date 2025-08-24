import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import wrtc from "wrtc";
import WS from "ws";  // Renamed import to avoid conflict

// Store original globals for restoration
const originalGlobals = {
  crypto: globalThis.crypto,
  RTCPeerConnection: globalThis.RTCPeerConnection,
  RTCIceCandidate: globalThis.RTCIceCandidate,
  RTCSessionDescription: globalThis.RTCSessionDescription,
  WebSocket: globalThis.WebSocket
};

import { browserWSWithReconnect } from "@noisytransfer/transport/ws/ws.js";
import { rtcInitiator, rtcResponder } from "@noisytransfer/transport/webrtc/index.js";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth/index.js";
import { suite } from "@noisytransfer/crypto/suite.js";
import { STATES } from "@noisytransfer/noisyauth/states.js";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function cleanDown(rawA, rawB, sigA, sigB) {
  try { await rawA?.close?.(); } catch {}
  try { await rawB?.close?.(); } catch {}
  try { sigA?.close?.(); } catch {}
  try { sigB?.close?.(); } catch {}
  await sleep(100);
}

function waitUp(tx) {
  return new Promise((resolve) => {
    try {
      if (tx?.isConnected || tx?.isUp || tx?.readyState === "open") return resolve();
      const un = tx.onUp?.(() => { try { un?.(); } catch {} resolve(); });
      if (!un) queueMicrotask(resolve);
    } catch { queueMicrotask(resolve); }
  });
}

function trackPath() {
  const arr = [];
  return {
    arr,
    onState: (t) => { if (t && "to" in t) arr.push(t.to); }
  };
}

async function makeSignal(room, side) {
  const url = `ws://localhost:1234/ws?appID=${room}&side=${side}`;
  const wsTx = browserWSWithReconnect(url, { 
    maxRetries: 2,
    // Use the imported WS directly
    wsConstructor: WS
  });

  const outQ = [];
  const flush = () => {
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try { wsTx.send(m); } catch { outQ.unshift(m); break; }
    }
  };
  wsTx.onUp(flush);

  return {
    send: m => { if (wsTx.isConnected) wsTx.send(m); else outQ.push(m); },
    close: (...a) => wsTx.close(...a),
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

async function genReceiverMsg() {
  const kp = await suite.kem.generateKeyPair();
  return await suite.kem.serializePublicKey(kp.publicKey);
}

async function genSenderVerifyKey() {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true,
    ["sign","verify"]
  );
  return crypto.subtle.exportKey("spki", publicKey);
}

async function dial(role, signal, rtcCfg = {}) {
  return role === "initiator" ? rtcInitiator(signal, rtcCfg)
                              : rtcResponder(signal, rtcCfg);
}

function assertInOrder(seq, expected, msg) {
  let pos = -1;
  for (const want of expected) {
    const i = seq.indexOf(want, pos + 1);
    assert.ok(i !== -1, `${msg || "sequence"}: missing ${want} after index ${pos}`);
    pos = i;
  }
}

const last = (arr) => arr[arr.length - 1];

function filterOutbound(tx, dropFn) {
  const origSend = tx.send.bind(tx);
  return {
    ...tx,
    send: (m) => { if (!dropFn?.(m)) origSend(m); },
  };
}

function wrappedTest(name, ...args) {
  let options = {};
  let fn;
  
  if (typeof args[0] === 'function') {
    fn = args[0];
  } else {
    options = args[0] || {};
    fn = args[1];
  }
  
  test(name, { ...options, timeout: options.timeout || 35_000 }, async (t) => {
    // Set all required globals for the test
    globalThis.crypto = webcrypto;
    globalThis.RTCPeerConnection = wrtc.RTCPeerConnection;
    globalThis.RTCIceCandidate = wrtc.RTCIceCandidate;
    globalThis.RTCSessionDescription = wrtc.RTCSessionDescription;
    globalThis.WebSocket = WS;  // Set global WebSocket
    
    try {
      await fn(t);
    } finally {
      // Restore original globals
      Object.entries(originalGlobals).forEach(([key, value]) => {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      });
      if (global.gc) global.gc();
    }
  });
}

wrappedTest("authcore-rtc: happy path → same SAS & expected state flow", async (t) => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA, rawB] = await Promise.all([
    dial("initiator", sigA, { iceServers: [] }),
    dial("responder", sigB, { iceServers: [] }),
  ]);
  await Promise.all([waitUp(rawA), waitUp(rawB)]);

  const recvMsg = await genReceiverMsg();
  const sendMsg = await genSenderVerifyKey();

  let sasA, sasB;
  const sPath = trackPath();
  const rPath = trackPath();

  const pA = new Promise((res, rej) => {
    createAuthSender(rawA, {
      onState: sPath.onState,
      onSAS: s => { sasA = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "rtc", sessionId, sendMsg });
  });

  const pB = new Promise((res, rej) => {
    createAuthReceiver(rawB, {
      onState: rPath.onState,
      onSAS: s => { sasB = s; },
      waitConfirm: () => true,
      onDone: res,
      onError: rej,
    }, { policy: "rtc", sessionId, recvMsg });
  });

  try {
    await Promise.all([pA, pB]);
    assertInOrder(sPath.arr, [STATES.WAIT_COMMIT, STATES.WAIT_REVEAL, STATES.SAS_CONFIRM, STATES.READY], "sender path");
    assertInOrder(rPath.arr, [STATES.WAIT_COMMIT, STATES.WAIT_OFFER, STATES.SAS_CONFIRM, STATES.READY], "receiver path");
    assert.equal(last(sPath.arr), STATES.READY, "sender final state");
    assert.equal(last(rPath.arr), STATES.READY, "receiver final state");
    assert.ok(sasA && sasB, "SAS missing");
    assert.equal(sasA, sasB, "SAS mismatch");
  } finally {
    await cleanDown(rawA, rawB, sigA, sigB);
  }
});

wrappedTest("authcore-rtc: timeout_wait_commit (receiver, no peer)", async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const sigB = await makeSignal(room, "B");
  const rawB = await dial("responder", sigB, {});
  await waitUp(rawB);

  const recvMsg = await genReceiverMsg();

  let sawErr;
  await new Promise((res) => {
    createAuthReceiver(rawB, {
      waitConfirm: () => true,
      onError: (e) => { sawErr = e; res(); },
      onDone: () => { throw new Error("must not complete"); },
    }, { policy: "rtc", sessionId, recvMsg });
  });

  assert.ok(sawErr, "expected receiver error");
  assert.match(String(sawErr.code || sawErr), /timeout_wait_commit|NC_AUTH_TIMEOUT|timeout/i);
});

wrappedTest("authcore-rtc: timeout_wait_offer (receiver)", async (t) => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA0, rawB] = await Promise.all([
    dial("initiator", sigA, {}),
    dial("responder", sigB, {}),
  ]);
  await Promise.all([waitUp(rawA0), waitUp(rawB)]);

  // Drop *auth* "offer" from the sender:
  const rawA = filterOutbound(rawA0, m => m?.type === "offer");

  const recvMsg = await genReceiverMsg();
  const sendMsg = await genSenderVerifyKey();

  let sawErr;
  const done = Promise.all([
    new Promise((res) => {
      createAuthSender(rawA, {
        waitConfirm: () => true,
        onError: () => res(),
        onDone: () => res(),
      }, { policy: "rtc", sessionId, sendMsg });
    }),
    new Promise((res) => {
      createAuthReceiver(rawB, {
        waitConfirm: () => true,
        onError: (e) => { sawErr = e; res(); },
        onDone: () => { throw new Error("receiver must not complete"); },
      }, { policy: "rtc", sessionId, recvMsg });
    }),
  ]);

  try {
    await done;
    assert.ok(sawErr, "expected receiver error");
    assert.match(String(sawErr.code || sawErr), /timeout_wait_offer|timeout/i);
  } finally {
    await cleanDown(rawA0, rawB, sigA, sigB);
  }
});

wrappedTest("authcore-rtc: timeout_wait_reveal (sender)", async (t) => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA0, rawB0] = await Promise.all([dial("initiator", sigA, {}), dial("responder", sigB, {})]);
  await Promise.all([waitUp(rawA0), waitUp(rawB0)]);

  const rawB = filterOutbound(rawB0, m => m?.type === "reveal");

  const recvMsg = await genReceiverMsg();
  const sendMsg = await genSenderVerifyKey();

  let sawErr = null;
  const done = new Promise((res) => {
    createAuthSender(rawA0, {
      waitConfirm: () => true,
      onError: (e) => { sawErr = e; res(); },
      onDone: () => { throw new Error("sender must not complete"); },
    }, { policy: "rtc", sessionId, sendMsg });

    createAuthReceiver(rawB, {
      waitConfirm: () => true,
      onError: () => res(),
      onDone: () => res(),
    }, { policy: "rtc", sessionId, recvMsg });
  });

  try {
    await done;
    assert.ok(sawErr, "expected sender error");
    assert.match(String(sawErr.code || sawErr), /timeout_wait_reveal|timeout/i);
  } finally {
    await cleanDown(rawA0, rawB0, sigA, sigB);
  }
});

wrappedTest("authcore-rtc: timeout_wait_peer_confirm (sender)", async (t) => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA0, rawB0] = await Promise.all([dial("initiator", sigA, {}), dial("responder", sigB, {})]);
  await Promise.all([waitUp(rawA0), waitUp(rawB0)]);

  // Drop the receiver's rcvconfirm so the sender will time out
  const rawB = filterOutbound(rawB0, m => m?.type === "rcvconfirm");

  const recvMsg = await genReceiverMsg();
  const sendMsg = await genSenderVerifyKey();

  let sawErr = null;

  // Only resolve when the SENDER errors
  const senderDone = new Promise((res) => {
    createAuthSender(rawA0, {
      waitConfirm: () => true,
      onError: (e) => { sawErr = e; res(); },
      onDone: () => { throw new Error("sender must not complete"); },
    }, { policy: "rtc", sessionId, sendMsg });
  });

  // Run receiver, but don't resolve the test based on its completion
  createAuthReceiver(rawB, {
    waitConfirm: () => true,
    onError: () => {}, // ignore
    onDone: () => {},  // ignore (receiver will likely reach READY)
  }, { policy: "rtc", sessionId, recvMsg });

  try {
    await senderDone;
    assert.ok(sawErr, "expected sender error");
    assert.match(String(sawErr.code || sawErr), /timeout_wait_peer_confirm|timeout/i);
  } finally {
    await cleanDown(rawA0, rawB0, sigA, sigB);
  }
});