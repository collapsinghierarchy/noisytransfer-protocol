import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

import { withMailboxPair } from "@noisytransfer/test-helpers";

const nextTick = () => new Promise((r) => setTimeout(r, 0));

test("mailbox ws: basic A<->B roundtrip", { timeout: 10_000 }, async (t) => {
  // withMailboxPair(mode:"ws-ephemeral") starts an in-process broker and
  // registers a t.after() hook to shut it down.
  const { A, B, close } = await withMailboxPair(t, { mode: "ws-ephemeral" });
  t.after(async () => {
    try {
      close();
    } catch {}
    await nextTick();
  });

  const got = { a: null, b: null };

  const done = Promise.all([
    new Promise((res) =>
      B.onMessage((m) => {
        got.b = m;
        res();
      })
    ),
    new Promise((res) =>
      A.onMessage((m) => {
        got.a = m;
        res();
      })
    ),
  ]);

  A.send({ ping: 1 });
  B.send({ pong: 2 });

  await done;
  assert.deepEqual(got.b, { ping: 1 });
  assert.deepEqual(got.a, { pong: 2 });
});
