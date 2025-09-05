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

// ---------- TEST 2: DTLS-auth + cleartext DC (no PQ) ----------
test("DTLS-auth via SAS + cleartext stream over RTC DC (no PQ)", { timeout: 45_000 }, async (t) => {
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

  // If your "no PQ" path needs special msg material, generate it here.
  // Otherwise, we can reuse the same SAS flow as above (policy "rtc"):
  const recvMsg = await genReceiverMsg(); // or set to undefined if not needed
  const sendMsg = await genSenderVerifyKey(); // or set to undefined if not needed
  const sessionId = crypto.randomUUID();

  await Promise.all([
    new Promise((res, rej) => {
      createAuthSender(
        rawA,
        { onSAS: () => {}, waitConfirm: () => true, onDone: res, onError: rej },
        { policy: "rtc", sessionId, sendMsg, pq: false } // `pq: false` if your API supports it
      );
    }),
    new Promise((res, rej) => {
      createAuthReceiver(
        rawB,
        { onSAS: () => {}, waitConfirm: () => true, onDone: res, onError: rej },
        { policy: "rtc", sessionId, recvMsg, pq: false }
      );
    }),
  ]);

  // quick ping on cleartext DC to ensure channel viability
  const seen = new Promise((resolve) => {
    rawB.onMessage((m) => {
      if (m && m.type === "PING" && m.n === 2) resolve();
    });
  });
  rawA.send({ type: "PING", n: 2 });
  await seen;

  // drain / flush best-effort (tolerate timeout with wrtc)
  try {
    await flush(rawA, { timeoutMs: 10_000 });
  } catch {}
  try {
    await flush(rawB, { timeoutMs: 10_000 });
  } catch {}
});
