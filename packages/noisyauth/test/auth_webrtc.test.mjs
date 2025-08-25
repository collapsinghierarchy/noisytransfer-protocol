// packages/noisyauth/test/authcore_webrtc_integration.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
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
import { STATES } from "@noisytransfer/noisyauth/states.js";

import {
  STREAM,
  packStreamInit,
  packStreamData,
  parseStreamData,
} from "@noisytransfer/noisystream";
import { b64u as bytesToB64u, unb64u as b64uToBytes } from "@noisytransfer/util";
import * as sig from "@noisytransfer/crypto";
import { suite } from "@noisytransfer/crypto"; // for KEM pubkey in the happy-path test

const isBun = typeof globalThis.Bun !== "undefined";

const CHUNK = 64 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (Math.random() * 256) | 0;
  return u;
}
async function sha256Hex(u8) {
  const view = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const d = await crypto.subtle.digest("SHA-256", view);
  return Buffer.from(d).toString("hex");
}

/* ------------------------ signaling over your backend ------------------------ */
async function makeSignal(room, side) {
  const url = `ws://localhost:1234/ws?appID=${room}&side=${side}`;
  const wsTx = browserWSWithReconnect(url, { maxRetries: 2 }); // keep as in your DTLS baseline

  const outQ = [];
  const flush = () => {
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try {
        wsTx.send(m);
      } catch {
        outQ.unshift(m);
        break;
      }
    }
  };
  const unUp = wsTx.onUp(flush);

  return {
    send: (m) => {
      if (wsTx.isConnected) wsTx.send(m);
      else outQ.push(m);
    },
    close: (...a) => {
      try { unUp?.(); } catch {}
      return wsTx.close(...a);
    },
    onMessage: (cb) =>
      wsTx.onMessage((msg) => {
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "offer":
          case "answer":
          case "ice":
            cb(msg);
            break;
          default:
          // ignore others
        }
      }),
    onClose: (cb) => wsTx.onClose(cb),
  };
}

/* --------------------------------- dial RTC -------------------------------- */
async function dial(role, signal, rtcCfg = {}) {
  return role === "initiator" ? rtcInitiator(signal, rtcCfg) : rtcResponder(signal, rtcCfg);
}

/* ----------------------- tiny helpers for happy-path ------------------------ */
function trackPath() {
  const arr = [];
  return {
    arr,
    onState: (t) => {
      if (t && "to" in t) arr.push(t.to);
    },
  };
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

async function waitUp(tx) {
  return new Promise((resolve) => {
    if (tx?.isConnected || tx?.readyState === "open") return resolve();
    const un = tx.onUp?.(() => {
      try { un?.(); } catch {}
      resolve();
    });
    if (!un) queueMicrotask(resolve);
  });
}

async function genReceiverMsg() {
  const kp = await suite.kem.generateKeyPair();
  return await suite.kem.serializePublicKey(kp.publicKey);
}
async function genSenderVerifyKey() {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  return crypto.subtle.exportKey("spki", publicKey);
}

/* --------------------- cleanup helpers to avoid leaks ---------------------- */
async function closeTx(tx) {
  if (!tx?.close) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        try { un?.(); } catch {}
        resolve();
      }
    };
    const un = tx.onClose?.(() => finish());
    try {
      const ret = tx.close();
      if (ret && typeof ret.then === "function") ret.then(finish).catch(() => finish());
    } catch {
      finish();
    }
    setTimeout(finish, 200);
  });
}
async function cleanDown(rawA, rawB, sigA, sigB) {
  await Promise.all([closeTx(rawA), closeTx(rawB), closeTx(sigA), closeTx(sigB)]);
}

test(
  "authcore-rtc: happy path → same SAS & expected state flow",
  { timeout: 20000 },
  { skip: isBun && "wrtc not supported by Bun yet" },
  async () => {
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
      createAuthSender(
        rawA,
        {
          onState: sPath.onState,
          onSAS: (s) => {
            sasA = s;
          },
          waitConfirm: () => true,
          onDone: res,
          onError: rej,
        },
        { policy: "rtc", sessionId, sendMsg }
      );
    });

    const pB = new Promise((res, rej) => {
      createAuthReceiver(
        rawB,
        {
          onState: rPath.onState,
          onSAS: (s) => {
            sasB = s;
          },
          waitConfirm: () => true,
          onDone: res,
          onError: rej,
        },
        { policy: "rtc", sessionId, recvMsg }
      );
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
  }
);


test("authcore-rtc: timeout_wait_commit (receiver, no peer)", async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const sigB = await makeSignal(room, "B");
  const rawB = await dial("responder", sigB, {});
  const recvMsg = await genReceiverMsg();

  let sawErr;
  await new Promise((res) => {
    createAuthReceiver(rawB, {
      waitConfirm: () => true,
      onError: (e) => { sawErr = e; res(); },
      onDone: () => { throw new Error("must not complete"); },
    }, { policy: "rtc", sessionId, recvMsg });
  });
  try {
  assert.ok(sawErr, "expected receiver error");
  assert.match(String(sawErr.code || sawErr), /timeout_wait_commit|NC_AUTH_TIMEOUT|timeout/i);
  } finally {
    await cleanDown(undefined, rawB, undefined, sigB);
  }
});