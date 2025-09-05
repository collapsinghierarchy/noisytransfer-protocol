import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import { skipIfNoIntegration, withMailboxPair } from "@noisytransfer/test-helpers";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { suite } from "@noisytransfer/crypto";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fail fast if a promise hangs, so node:test won’t cancel the test unexpectedly. */
function withTimeout(p, ms, label = "operation") {
  let to;
  const timeout = new Promise((_, rej) => {
    to = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(to)), timeout]);
}

/** Mute/unmute inbound frames to simulate flaky links (server → client). */
function wrapInboundMute(tx) {
  let mute = false;
  const local = new Set();
  const backlog = [];
  const un = tx.onMessage((m) => {
    if (mute) {
      backlog.push(m);
      return;
    }
    for (const cb of local) cb(m);
  });
  return {
    ...tx,
    onMessage(cb) {
      local.add(cb);
      return () => local.delete(cb);
    },
    muteIn() {
      mute = true;
    },
    unmuteIn() {
      mute = false;
      while (backlog.length) {
        const m = backlog.shift();
        for (const cb of local) cb(m);
      }
    },
    _teardown() {
      try {
        un?.();
      } catch {}
      local.clear();
      backlog.length = 0;
    },
  };
}

async function genRecvMsg() {
  const kp = await suite.kem.generateKeyPair();
  return suite.kem.serializePublicKey(kp.publicKey);
}
function genSendMsg() {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

/* 1) Happy path */
test("authcore: mailbox happy path → same SAS", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);

  const { A, B, room, close } = await withMailboxPair(t, { mode: "ws-ephemeral" });
  t.after(async () => {
    try {
      await close();
    } catch {}
  });
  t.diagnostic(`room=${room}`);

  const sessionId = crypto.randomUUID();
  const recvMsg = await genRecvMsg();
  const sendMsg = genSendMsg();

  let sasA, sasB;
  const pA = new Promise((res, rej) => {
    createAuthSender(
      A,
      {
        onSAS: (s) => {
          sasA = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, sendMsg }
    );
  });
  const pB = new Promise((res, rej) => {
    createAuthReceiver(
      B,
      {
        onSAS: (s) => {
          sasB = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, recvMsg }
    );
  });

  await Promise.all([
    withTimeout(pA, 10_000, "sender auth (happy)"),
    withTimeout(pB, 10_000, "receiver auth (happy)"),
  ]);
  assert.ok(sasA && sasB, "SAS digits missing");
  assert.equal(sasA, sasB, "SAS mismatch");
});

/* 2) Async start: receiver first */
test("authcore: async start → receiver first, sender later", { timeout: 30_000 }, async (t) => {
  skipIfNoIntegration(t);

  const { A, B, room, close } = await withMailboxPair(t, { mode: "ws-ephemeral" });
  t.after(async () => {
    try {
      await close();
    } catch {}
  });
  t.diagnostic(`room=${room}`);

  const sessionId = crypto.randomUUID();
  const recvMsg = await genRecvMsg();

  let sasB;
  const pB = new Promise((res, rej) => {
    createAuthReceiver(
      B,
      {
        onSAS: (s) => {
          sasB = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, recvMsg }
    );
  });

  // Receiver is listening; start sender after a short delay
  await sleep(200);

  const sendMsg = genSendMsg();
  let sasA;
  const pA = new Promise((res, rej) => {
    createAuthSender(
      A,
      {
        onSAS: (s) => {
          sasA = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, sendMsg }
    );
  });

  await Promise.all([
    withTimeout(pA, 10_000, "sender auth (async-start)"),
    withTimeout(pB, 10_000, "receiver auth (async-start)"),
  ]);
  assert.equal(sasA, sasB);
});

/* 3) Chaos flaps on receiver inbound */
test("authcore: chaos flaps → SAS still completes", { timeout: 40_000 }, async (t) => {
  skipIfNoIntegration(t);

  const { A, B: Braw, room, close } = await withMailboxPair(t, { mode: "ws-ephemeral" });
  const B = wrapInboundMute(Braw);
  t.after(async () => {
    try {
      await close();
    } catch {}
    B._teardown?.();
  });
  t.diagnostic(`room=${room}`);

  const sessionId = crypto.randomUUID();
  const recvMsg = await genRecvMsg();

  let sasB;
  const pB = new Promise((res, rej) => {
    createAuthReceiver(
      B,
      {
        onSAS: (s) => {
          sasB = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, recvMsg }
    );
  });

  await sleep(150);

  const sendMsg = genSendMsg();
  let sasA;
  const pA = new Promise((res, rej) => {
    createAuthSender(
      A,
      {
        onSAS: (s) => {
          sasA = s;
        },
        waitConfirm: () => true,
        onDone: res,
        onError: rej,
      },
      { policy: "ws_async", sessionId, roomId: room, sendMsg }
    );
  });

  // Flap receiver inbound 5× while auth is in flight
  for (let i = 0; i < 5; i++) {
    B.muteIn();
    await sleep(200 + i * 40);
    B.unmuteIn();
    await sleep(120 + i * 30);
  }

  await Promise.all([
    withTimeout(pA, 15_000, "sender auth (chaos)"),
    withTimeout(pB, 15_000, "receiver auth (chaos)"),
  ]);
  assert.equal(sasA, sasB);
});
