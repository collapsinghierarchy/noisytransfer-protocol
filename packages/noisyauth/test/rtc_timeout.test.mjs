// Global error handlers
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && (err.stack || err));
});
process.on("unhandledRejection", (reason, p) => {
  console.error("[unhandledRejection]", reason, p);
});

import assert from "node:assert/strict";
import { test, after } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import {
  skipIfNoIntegration,
  installWrtcGlobals,
  makeSignal,
  shutdownEphemeralBroker,
} from "@noisytransfer/test-helpers";
import wrtc from "@roamhq/wrtc";
installWrtcGlobals(wrtc);

import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { suite } from "@noisytransfer/crypto";

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
async function closeTx(tx) {
  if (!tx?.close) return;
  // Best-effort: ensure underlying PeerConnection is closed
  try {
    tx.pc?.close?.();
  } catch {}
  try {
    tx.dc?.close?.();
  } catch {}
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        try {
          un?.();
        } catch {}
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
  console.log("Cleaning up connections...");
  await Promise.all([closeTx(rawA), closeTx(rawB), closeTx(sigA), closeTx(sigB)]);
  console.log("Cleanup complete.");
}

/** Drop the *first* outbound send (sender's auth "offer") and pass-through everything else. */
function dropFirstOutbound(tx) {
  let dropped = false;
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "send") {
        return (m) => {
          if (!dropped) {
            dropped = true;
            return;
          } // drop first frame
          return target.send(m);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/* ---------- wrapped suite ---------- */

let lastRawA0, lastRawB, lastSigA, lastSigB;

test("webrtc timeout suite (isolated)", { timeout: 30000 }, async (t) => {
  skipIfNoIntegration(t);
  installWrtcGlobals(wrtc);
  console.log("Test started: webrtc timeout suite");
  await t.test("authcore-rtc: timeout_wait_offer (receiver)", { timeout: 25_000 }, async (t) => {
    const room = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
    const [rawA0, rawB] = await Promise.all([
      dial("initiator", sigA, { iceServers: [] }),
      dial("responder", sigB, { iceServers: [] }),
    ]);

    // Per-test cleanup, even if assertions throw:
    t.after(async () => {
      await cleanDown(rawA0, rawB, sigA, sigB);
    });

    const rawA = dropFirstOutbound(rawA0);

    const recvMsg = await genReceiverMsg();
    const sendMsg = await genSenderVerifyKey();

    let sawErr;
    const done = Promise.all([
      new Promise((res) => {
        try {
          createAuthSender(
            rawA,
            {
              waitConfirm: () => true,
              onError: (e) => {
                console.error("Sender onError", e);
                res();
              },
              onDone: () => {
                console.log("Sender onDone");
                res();
              },
            },
            { policy: "rtc", sessionId, sendMsg }
          );
        } catch (err) {
          console.error("Sender createAuthSender error", err);
          res();
        }
      }),
      new Promise((res) => {
        try {
          createAuthReceiver(
            rawB,
            {
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
            },
            { policy: "rtc", sessionId, recvMsg }
          );
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

// Ensure native resources are torn down after all tests
after(async () => {
  // give any pending microtasks a chance to run
  await new Promise((r) => setTimeout(r, 0));
  // wrtc has no global close; per-object closes handled in t.after above
  // optional: help finalizers run before process exit
  if (global.gc) {
    try {
      global.gc();
    } catch {}
  }
  try {
    await shutdownEphemeralBroker();
  } catch {}
});
