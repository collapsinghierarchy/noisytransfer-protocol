// packages/noisyauth/test/rtc_teardown_e2e.test.mjs
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

import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { suite } from "@noisytransfer/crypto";

// ---- helpers ----
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

// minimal material the auth handshake expects
async function genReceiverMsg() {
  const kp = await suite.kem.generateKeyPair();
  return suite.kem.serializePublicKey(kp.publicKey); // ArrayBuffer
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
  return crypto.subtle.exportKey("spki", publicKey); // ArrayBuffer
}

test(
  "RTC teardown: minimal connect then immediate close (no payload)",
  { timeout: 15_000 },
  async (t) => {
    skipIfNoIntegration(t);
    installWrtcGlobals(wrtc);

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
    try {
      rawA.close?.();
    } catch {}
    try {
      rawB.close?.();
    } catch {}
  }
);

test("RTC teardown: post-auth single PING then clean close", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);
  installWrtcGlobals(wrtc);

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
  const sessionId = crypto.randomUUID();

  // provide required auth material
  const [recvMsg, sendMsg] = await Promise.all([genReceiverMsg(), genSenderVerifyKey()]);

  await Promise.all([
    new Promise((res, rej) => {
      createAuthSender(
        rawA,
        { onSAS: () => {}, waitConfirm: () => true, onDone: res, onError: rej },
        { policy: "rtc", sessionId, sendMsg }
      );
    }),
    new Promise((res, rej) => {
      createAuthReceiver(
        rawB,
        { onSAS: () => {}, waitConfirm: () => true, onDone: res, onError: rej },
        { policy: "rtc", sessionId, recvMsg }
      );
    }),
  ]);

  // ping once, then close
  const seen = new Promise((resolve) => {
    const un = rawB.onMessage?.((m) => {
      if (m && m.type === "PING" && m.n === 1) {
        try {
          un?.();
        } catch {}
        resolve();
      }
    });
  });
  rawA.send({ type: "PING", n: 1 });
  await seen;

  try {
    await rawA.close?.();
  } catch {}
  try {
    await rawB.close?.();
  } catch {}
});
