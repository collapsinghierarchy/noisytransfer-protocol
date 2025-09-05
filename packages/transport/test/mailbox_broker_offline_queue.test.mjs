import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

import { startMailboxBroker, shutdownMailboxBroker } from "@noisytransfer/test-helpers";
import { mailboxTransport as mkMailbox } from "@noisytransfer/transport";
import { randomUUID } from "node:crypto";

test("mailbox ws: queue while A is offline, deliver on connect", { timeout: 10_000 }, async (t) => {
  // Start in-process mailbox broker
  const base = await startMailboxBroker(); // ws://127.0.0.1:<port>/ws

  let A, B;
  // Tear down sockets first, then the broker
  t.after(async () => {
    try {
      A?.close();
    } catch {}
    try {
      B?.close();
    } catch {}
    try {
      await shutdownMailboxBroker();
    } catch {}
  });

  const room = randomUUID();

  // Bring up B first and send while A is offline
  B = await mkMailbox(base, { room, side: "B", sessionId: randomUUID() });
  B.send({ hello: "A?" });
  B.send({ second: true });

  // Now connect A and assert queued frames arrive (in order)
  A = await mkMailbox(base, { room, side: "A", sessionId: randomUUID() });

  const seen = [];
  await new Promise((resolve, reject) => {
    const un = A.onMessage((m) => {
      seen.push(m);
      if (seen.length === 2) {
        try {
          un?.();
        } catch {}
        clearTimeout(to);
        resolve();
      }
    });
    // Safety net: ensure this timer never holds the event loop open
    const to = setTimeout(() => {
      try {
        un?.();
      } catch {}
      reject(new Error("Timed out waiting for 2 queued messages"));
    }, 3000);
    to.unref?.();
  });

  assert.deepEqual(seen, [{ hello: "A?" }, { second: true }]);
});
