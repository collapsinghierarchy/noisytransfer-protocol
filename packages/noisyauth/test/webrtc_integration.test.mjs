process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && (err.stack || err));
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[unhandledRejection]', reason && (reason.stack || reason), 'in', p);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from 'node:timers/promises';
import net from "node:net";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
import WebSocket from "ws";
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

 // Store original globals for restoration
 const originalGlobals = {
   crypto: globalThis.crypto,
   RTCPeerConnection: globalThis.RTCPeerConnection,
   RTCIceCandidate: globalThis.RTCIceCandidate,
   RTCSessionDescription: globalThis.RTCSessionDescription,
   WebSocket: globalThis.WebSocket
 };

function restoreGlobal(name, value) {
  // Don’t try to reset read-only accessors like globalThis.crypto in Node
  const desc = Object.getOwnPropertyDescriptor(globalThis, name);
  const readOnly = desc && !desc.writable && !desc.set; // data prop not writable AND no setter
  if (readOnly) return; // skip
  if (value === undefined) {
    try { delete globalThis[name]; } catch {}
  } else {
    try { globalThis[name] = value; } catch {}
  }
}


import { browserWSWithReconnect, rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth/index.js";
import { suite } from "@noisytransfer/crypto";
import { STATES } from "@noisytransfer/noisyauth/states.js";

const isBun = typeof globalThis.Bun !== 'undefined';

if (!isBun) {
  globalThis.RTCPeerConnection ??= wrtc.RTCPeerConnection;
  globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;
  globalThis.RTCIceCandidate ??= wrtc.RTCIceCandidate;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    // Fallback in case onClose isn’t implemented
    setTimeout(finish, 200);
  });
}

async function cleanDown(rawA, rawB, sigA, sigB) {
  await Promise.all([closeTx(rawA), closeTx(rawB), closeTx(sigA), closeTx(sigB)]);
}

function waitUp(tx, { timeoutMs = 0, optional = false } = {}) {
  return new Promise((resolve) => {
    if (optional) return resolve();
    if (tx?.isConnected || tx?.isUp || tx?.readyState === "open") return resolve();

    let done = false;
    const finish = () => { if (!done) { done = true; try { un?.(); } catch {} resolve(); } };

    let un = null;
    if (typeof tx?.onUp === "function") {
      un = tx.onUp(finish);
    } else if (typeof tx?.onMessage === "function") {
      // fallback heuristic: first message means “usable”
      un = tx.onMessage(function first() { finish(); });
    }

    if (timeoutMs > 0) setTimeout(finish, timeoutMs);
    // if neither onUp nor onMessage are present, don't hang forever:
    if (!un && timeoutMs === 0) setTimeout(finish, 0);
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
    maxRetries: 0,
    // Use the imported WebSocket directly
    wsConstructor: WebSocket
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

  test(name, { ...options, timeout: options.timeout || 20000, skip: isBun && 'wrtc not supported by Bun yet' }, async (t) => {
    // Globals were already set at module scope using ??=.
    // Avoid overwriting read-only accessors like globalThis.crypto.
    if (!isBun) {
      globalThis.RTCPeerConnection ??= wrtc.RTCPeerConnection;
      globalThis.RTCIceCandidate ??= wrtc.RTCIceCandidate;
      globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;
    }
    if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // fix: use the imported name
    
    try {
      await fn(t);
    } finally {
      // Restore original globals (safely; skip non-writable like crypto)
      Object.entries(originalGlobals).forEach(([key, value]) => restoreGlobal(key, value));
      if (global.gc) global.gc();
    }
  });
}

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
    assert.match(String(sawErr.code || sawErr), /timeout_wait_peer_confirm|timeout/i);
  } finally {
    console.log("Cleaning up...");
    await cleanDown(rawA0, rawB0, sigA, sigB);
  }
});

test('no leaked net sockets (ignoring stdio)', async () => {
  await delay(30);

  // eslint-disable-next-line no-underscore-dangle
  const handles = process._getActiveHandles?.() || [];

  const nonStdioSockets = handles.filter((h) =>
    h instanceof net.Socket &&
    !h.isTTY &&                  // not a TTY
    h !== process.stdout &&      // not stdout
    h !== process.stderr         // not stderr
  );

  // Helpful logging while you dial it in:
  for (const s of nonStdioSockets) {
    console.log('LEAK? socket',
      'local=', s.localAddress, s.localPort,
      'remote=', s.remoteAddress, s.remotePort,
      'destroyed=', s.destroyed
    );
  }

  assert.equal(
    nonStdioSockets.length,
    0,
    `Expected 0 non-stdio sockets, found ${nonStdioSockets.length}`
  );
});