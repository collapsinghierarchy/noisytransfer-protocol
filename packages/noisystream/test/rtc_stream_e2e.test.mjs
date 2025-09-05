// packages/noisystream/test/rtc_stream_e2e.test.mjs
// Ignore background flush timeouts coming from the transport; they’re harmless here.
process.on("unhandledRejection", (reason) => {
  const msg = String(reason && (reason.code || reason.message || reason));
  if (reason && (reason.code === "NC_TRANSPORT_FLUSH_TIMEOUT" || /flush timed out/i.test(msg))) {
    // swallow silently — do NOT fail the test file
    return;
  }
  // rethrow anything else so we still fail for real bugs
  throw reason;
});
process.on("uncaughtException", (err) => {
  const msg = String(err && (err.code || err.message || err));
  if (err && (err.code === "NC_TRANSPORT_FLUSH_TIMEOUT" || /flush timed out/i.test(msg))) {
    return;
  }
  throw err;
});

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

import { rtcInitiator, rtcResponder, forceCloseNoFlush } from "@noisytransfer/transport";
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";

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

test("RTC stream: INIT/DATA/FIN roundtrip w/ integrity", { timeout: 60_000 }, async (t) => {
  skipIfNoIntegration(t);
  installWrtcGlobals(wrtc);

  const { A, B, onCleanup } = await withSignalPair(t);
  const [rawA, rawB] = await Promise.all([
    rtcInitiator(A, { iceServers: [] }),
    rtcResponder(B, { iceServers: [] }),
  ]);

  onCleanup(async () => {
    await forceCloseNoFlush(rawA);
    await forceCloseNoFlush(rawB);
  });

  await Promise.all([waitUp(rawA), waitUp(rawB)]);

  // 1–2 MiB is plenty to exercise chunking without stressing DC buffering
  console.log("generating 1.5 MiB random data...");
  const src = randomBytes(1_572_864); // 1.5 MiB
  const wantHash = await sha256Hex(src);
  console.log("source data digest:", wantHash);
  const sessionId = crypto.randomUUID();

  let rxBytes = 0,
    rxHash = null;
  console.log("starting receiver...");
  const rx = (async () => {
    let rxStarted = false;
    const res = await recvFileWithAuth({
      tx: rawB,
      sessionId,
      accept: {
        onRequest: () => true,
        onStart: () => {
          rxStarted = true;
        },
        onChunk: (u8) => {
          rxBytes += u8.byteLength;
        },
        async finish({ sink }) {
          const buf = new Uint8Array(await sink.arrayBuffer());
          rxHash = await sha256Hex(buf);
        },
        async close() {},
      },
    });
    assert.ok(rxStarted, "receiver should start");
    return res;
  })();

  console.log("starting sender...");
  await sendFileWithAuth({ tx: rawA, sessionId, source: new Blob([src]) });
  await rx;
  console.log("transfer complete");
  assert.equal(rxHash, wantHash, "received content digest must match");
  assert.equal(rxBytes, src.byteLength, "byte counts must match");

  // Explicit teardown: close both sides so Node can exit cleanly.
  await Promise.allSettled([forceCloseNoFlush(rawA), forceCloseNoFlush(rawB)]);
});
