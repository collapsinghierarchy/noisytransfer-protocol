import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
import {
  installWrtcGlobals,
  makeSignal,
  shutdownEphemeralBroker,
} from "@noisytransfer/test-helpers";
installWrtcGlobals(wrtc);

import { flush, rtcInitiator, rtcResponder } from "@noisytransfer/transport";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const room = () => crypto.randomUUID?.() ?? String(Math.random());

function waitUp(tx) {
  return new Promise((resolve) => {
    if (tx?.isConnected) return resolve();
    const un = tx?.onUp?.(() => {
      try {
        un?.();
      } catch {}
      resolve();
    });
    if (!un) setTimeout(resolve, 0);
  });
}

// Pump N frames with small yields; tolerate occasional send() throws under pressure
async function pumpBacklog(sender, count, payload) {
  let i = 0;
  while (i < count) {
    try {
      sender.send({ type: "DATA", i, payload });
      i++;
    } catch {
      // queue full — give DC a breath and retry same index
      await sleep(1);
    }
    if ((i & 7) === 7) await sleep(0); // occasional yield
  }
}

test("flush drains wrtc transport and respects timeoutMs (impl)", { timeout: 45000 }, async () => {
  const r = room();
  const [sigA, sigB] = await Promise.all([makeSignal(r, "A"), makeSignal(r, "B")]);
  const [a, b] = await Promise.all([
    rtcInitiator(sigA, { iceServers: [] }),
    rtcResponder(sigB, { iceServers: [] }),
  ]);

  await Promise.all([waitUp(a), waitUp(b)]);

  // Count frames at receiver to confirm all are delivered
  let recvCount = 0;
  b.onMessage?.(() => {
    recvCount++;
  });

  // Build a modest backlog: 256 frames of ~8 KiB payload to avoid huge JSON bloat
  const CHUNK = new Uint8Array(8 * 1024).fill(7);
  const FRAMES = 256;
  await pumpBacklog(a, FRAMES, CHUNK);

  // Now flush with a clear timeout; use a proxy to ensure we hit our implementation
  const aSansFlush = new Proxy(a, {
    get(target, prop, recv) {
      if (prop === "flush") return undefined;
      return Reflect.get(target, prop, recv);
    },
  });

  const started = Date.now();
  await flush(aSansFlush, { timeoutMs: 20000, intervalMs: 5, lowThreshold: 64 * 1024 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 20000, `flush took too long (${elapsed}ms)`);

  // Give receiver up to 3s to drain message queue and deliver all frames
  const deadline = Date.now() + 3000;
  while (recvCount < FRAMES && Date.now() < deadline) {
    await sleep(5);
  }
  assert.equal(
    recvCount,
    FRAMES,
    `receiver did not consume all frames (got ${recvCount}/${FRAMES})`
  );

  await Promise.allSettled([a.close?.(), b.close?.(), sigA.close?.(), sigB.close?.()]);
  await shutdownEphemeralBroker();
});
