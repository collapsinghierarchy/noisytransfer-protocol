// packages/noisyauth/test/rtc_auth_e2e.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
import {
  installWrtcGlobals,
  withSignalPair,
  skipIfNoIntegration,
} from "@noisytransfer/test-helpers";

import { rtcInitiator, rtcResponder, flush } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { STATES } from "@noisytransfer/noisyauth/states";
import { suite } from "@noisytransfer/crypto";

// ---- install wrtc globals *once* at module load ----
installWrtcGlobals(wrtc);

// ---- small helpers ----
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
      try {
        un?.();
      } catch {}
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
    {
      name: "RSA-PSS",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  return crypto.subtle.exportKey("spki", publicKey);
}

// ---------- TEST 1: SAS auth happy path ----------
test("RTC auth: same SAS and expected state flow", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);

  const { A, B, onCleanup } = await withSignalPair(t);
  const [rawA, rawB] = await Promise.all([
    rtcInitiator(A, { iceServers: [] }),
    rtcResponder(B, { iceServers: [] }),
  ]);
  onCleanup(async () => {
    try {
      await rawA?.close?.();
    } catch {}
    try {
      await rawB?.close?.();
    } catch {}
  });

  await Promise.all([waitUp(rawA), waitUp(rawB)]);

  const recvMsg = await genReceiverMsg();
  const sendMsg = await genSenderVerifyKey();

  let sasA, sasB;
  const sPath = trackPath(),
    rPath = trackPath();
  const sessionId = crypto.randomUUID();

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

  await Promise.all([pA, pB]);

  // helpful breadcrumbs if this ever shifts again
  t.diagnostic(`sender states: ${sPath.arr.join(" -> ")}`);
  t.diagnostic(`receiver states: ${rPath.arr.join(" -> ")}`);

  assert.equal(String(sasA), String(sasB), "SAS strings should match");
  assert.equal(last(sPath.arr), STATES.READY, "sender READY");
  assert.equal(last(rPath.arr), STATES.READY, "receiver READY");

  // current state machine sequences
  assertInOrder(
    sPath.arr,
    [STATES.WAIT_COMMIT, STATES.WAIT_REVEAL, STATES.SAS_CONFIRM, STATES.READY],
    "sender path"
  );
  assertInOrder(
    rPath.arr,
    [STATES.WAIT_COMMIT, STATES.WAIT_OFFER, STATES.SAS_CONFIRM, STATES.READY],
    "receiver path"
  );

  // sanity ping after auth
  const seen = new Promise((resolve) => {
    rawB.onMessage((m) => {
      if (m && m.type === "PING" && m.n === 1) resolve();
    });
  });
  rawA.send({ type: "PING", n: 1 });
  await seen;
});

test("RTC noisyauth: delivered payloads match what was sent (bytes ↔ base64url)", { timeout: 60_000 }, async (t) => {
  skipIfNoIntegration(t);
  installWrtcGlobals(wrtc);

  const { A, B, onCleanup } = await withSignalPair(t);
  const [rawA, rawB] = await Promise.all([
    rtcInitiator(A, { iceServers: [] }),
    rtcResponder(B, { iceServers: [] }),
  ]);

  onCleanup(async () => {
    try { rawA.close?.(); } catch {}
    try { rawB.close?.(); } catch {}
  });

  // helper: waitUp is already defined earlier in this file; reuse it.
  await Promise.all([waitUp(rawA), waitUp(rawB)]);

  // Known-good “payloads”
  const rnd = (n) => {
    const u = new Uint8Array(n);
    crypto.getRandomValues(u);
    return u;
  };
  const msgS_sent = rnd(73); // pretend: sender SPKI bytes
  const msgR_sent = rnd(65); // pretend: receiver KEM pub bytes

  // Local b64url decoder (no padding)
  const unb64u8 = (s) => {
    const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };

  // Observed deliveries
  let msgS_rcv = null; // receiver’s onDone sees sender’s msgS (bytes)
  let msgR_snd = null; // sender’s onDone sees receiver’s msgR (b64url string)
  let sessionId = crypto.randomUUID();

  // Receiver: commits to msgR_sent (bytes)
  const recvP = new Promise((resolve, reject) => {
    createAuthReceiver(
      rawB,
      {
        onSAS: () => {},
        waitConfirm: async () => true,
        onDone: ({ msgS }) => {
          msgS_rcv = msgS; // Uint8Array
          resolve();
        },
        onError: reject,
      },
      { session: { policy: "rtc", sessionId: sessionId }, recvMsg: msgR_sent },
    );
  });

  // Sender: offers msgS_sent (bytes)
  const sendP = new Promise((resolve, reject) => {
    createAuthSender(
      rawA,
      {
        onSAS: () => {},
        waitConfirm: async () => true,
        onDone: ({ msgR }) => {
          msgR_snd = msgR; // base64url string
          resolve();
        },
        onError: reject,
      },
      { session: { policy: "rtc", sessionId: sessionId }, sendMsg: msgS_sent },
    );
  });

  await Promise.all([recvP, sendP]);

  // Assertions
  assert.ok(msgS_rcv instanceof Uint8Array, "receiver must get msgS as bytes");
  assert.equal(msgS_rcv.byteLength, msgS_sent.byteLength, "msgS length must match");
  assert.deepStrictEqual(new Uint8Array(msgS_rcv), new Uint8Array(msgS_sent), "msgS bytes must match exactly");

  assert.equal(typeof msgR_snd, "string", "sender must get msgR as base64url string");
  const msgR_dec = unb64u8(msgR_snd);
  assert.equal(msgR_dec.byteLength, msgR_sent.byteLength, "msgR length must match after base64url decode");
  assert.deepStrictEqual(msgR_dec, msgR_sent, "msgR bytes must match exactly after decode");

  // Best-effort flush/teardown
  try { await flush(rawA, { timeoutMs: 10_000 }); } catch {}
  try { await flush(rawB, { timeoutMs: 10_000 }); } catch {}
});