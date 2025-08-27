// test/noisystream/noisystream_webrtc_integration.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
globalThis.RTCPeerConnection     ??= wrtc.RTCPeerConnection;
globalThis.RTCIceCandidate       ??= wrtc.RTCIceCandidate;
globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;

import WebSocket from "ws";
globalThis.WebSocket = globalThis.WebSocket || WebSocket;

import { browserWSWithReconnect, rtcInitiator, rtcResponder } from "@noisytransfer/transport";

// noisystream API (stream-only)
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";
// frame helpers used in the bottom tests
import {
  STREAM,
  packStreamInit,  parseStreamInit,
  packStreamReady, parseStreamReady,
  packStreamData,  parseStreamData,
  packStreamFin,   parseStreamFin
} from "@noisytransfer/noisystream/frames";
import { NoisyError } from "@noisytransfer/errors/noisy-error";

/* -------------------------------- helpers ---------------------------------- */
async function cleanDown(rawA, rawB, sigA, sigB) {
  // Make this resilient and idempotent
  try { await rawA?.flush?.(); } catch {}
  try { await rawB?.flush?.(); } catch {}
  try { await rawA?.close?.(); } catch {}
  try { await rawB?.close?.(); } catch {}
  try { await sigA?.close?.(); } catch {}
  try { await sigB?.close?.(); } catch {}
}

async function sha256Hex(u8) {
  const view = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const d = await crypto.subtle.digest("SHA-256", view);
  return Buffer.from(d).toString("hex");
}

function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (Math.random() * 256) | 0;
  return u;
}

/* ------------------------ signaling over your backend ------------------------ */
async function makeSignal(room, side) {
  const url = `ws://localhost:1234/ws?appID=${room}&side=${side}`;

  // IMPORTANT: disable reconnects in tests to avoid lingering timers/handles
  const wsTx = browserWSWithReconnect(url, { maxRetries: 0, wsConstructor: WebSocket });

  const outQ = [];
  let closed = false;

  const flush = () => {
    if (closed) return;
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try { wsTx.send(m); } catch { outQ.unshift(m); break; }
    }
  };
  wsTx.onUp(flush);

  // Wrap listeners so we can drop references during close
  const listeners = [];
  function onMessage(cb) {
    const h = (msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "offer":
        case "answer":
        case "ice":
          cb(msg);
          break;
        default:
          /* ignore */;
      }
    };
    listeners.push({ type: "message", h });
    wsTx.onMessage(h);
  }
  function onClose(cb) {
    const h = (...a) => cb(...a);
    listeners.push({ type: "close", h });
    wsTx.onClose(h);
  }

  function removeAll() {
    // If your impl exposes .off(type, handler), use it; otherwise
    // re-register no-ops to break ref chains.
    for (const { type, h } of listeners) wsTx.off?.(type, h);
    listeners.length = 0;
    wsTx.onUp(() => {});
    wsTx.onMessage(() => {});
    wsTx.onClose(() => {});
  }

  return {
    send: (m) => {
      if (closed) return;
      if (wsTx.isConnected) wsTx.send(m);
      else outQ.push(m);
    },
    onMessage,
    onClose,
    async close(...a) {
      closed = true;
      outQ.length = 0;
      removeAll();
      try { wsTx.stop?.(); } catch {}
      try { wsTx.destroy?.(); } catch {}
      try { wsTx.close?.(...a); } catch {}
      // Give the event loop a tick to settle any final events
      await new Promise((r) => setImmediate(r));
    },
  };
}

/* --------------------------------- dial RTC -------------------------------- */
async function dial(role, signal, rtcCfg = {}) {
  return role === "initiator" ? rtcInitiator(signal, rtcCfg)
                              : rtcResponder(signal, rtcCfg);
}

/* ----------------------------------- test ---------------------------------- */

test("noisystream (RTC): end-to-end file transfer with integrity", { timeout: 60_000 }, async (t) => {
  // Surface stray async errors *inside* the subtest, and remove afterward
  const onUR = (reason, p) => t.fail(`UnhandledRejection: ${reason?.stack || reason}`);
  const onUE = (err) => t.fail(`UncaughtException: ${err?.stack || err}`);
  process.on("unhandledRejection", onUR);
  process.on("uncaughtException", onUE);
  t.after(() => {
    process.off("unhandledRejection", onUR);
    process.off("uncaughtException", onUE);
  });

  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA, rawB] = await Promise.all([
    dial("initiator", sigA, { iceServers: [] }),
    dial("responder", sigB, { iceServers: [] }),
  ]);

  // Always attempt cleanup, even on failure
  t.after(async () => {
    await cleanDown(rawA, rawB, sigA, sigB);
  });

  // Multi-chunk payload (~3.25 MiB)
  const TOTAL = 3_407_872;
  const src = randomBytes(TOTAL);
  const srcHash = await sha256Hex(src);

  // --- Start receiver first (so it’s ready to consume) ---
  const rxChunks = [];
  let rxStarted = false;
  const rxDone = (async () => {
    const res = await recvFileWithAuth({
      tx: rawB,
      sessionId,
      // optional sink: aggregate in-memory (or supply your own Writable-like)
      sink: {
        async write(u8) {
          rxChunks.push(u8.slice ? u8.slice() : new Uint8Array(u8));
          rxStarted = true;
        },
        async close() {},
      },
    });
    return res;
  })();

  // --- Kick off sender (auth + stream) ---
  await sendFileWithAuth({
    tx: rawA,
    sessionId,
    // sender supports Blob, Uint8Array, (async)iterables
    source: new Blob([src]),
    // chunkBytes: 64 * 1024, // (optional) default is fine
  });

  // Wait for receiver completion
  await rxDone;

  assert.ok(rxStarted, "receiver did not see stream_init");

  // Reassemble bytes
  const outLen = rxChunks.reduce((n, u) => n + u.byteLength, 0);
  const out = new Uint8Array(outLen);
  {
    let off = 0;
    for (const u of rxChunks) { out.set(u, off); off += u.byteLength; }
  }
  assert.equal(out.byteLength, TOTAL, "received length mismatch");

  // Integrity
  const outHash = await sha256Hex(out);
  assert.equal(outHash, srcHash, "file content hash mismatch");

  // Give any in-flight close events a tick, then close handles (also covered by t.after)
  await new Promise((r) => setImmediate(r));
  await cleanDown(rawA, rawB, sigA, sigB);
});

test('frames: roundtrip init/data/ready/fin', () => {
    const init = packStreamInit({ sessionId: 's', totalBytes: 123, encTag: new Uint8Array([1,2,3]) });
  assert.equal(init.type, STREAM.INIT);
  const initP = parseStreamInit(init);
  assert.equal(initP.sessionId, 's');
  assert.equal(initP.totalBytes, 123);
  assert.ok(initP.encTag instanceof Uint8Array);

  const data = packStreamData({ sessionId: 's', seq: 0, chunk: new Uint8Array([9,9,9]) });
  const dataP = parseStreamData(data);
  assert.equal(dataP.seq, 0);
  assert.equal(dataP.chunk.byteLength, 3);

  const ready = packStreamReady({ sessionId: 's' });
  const readyP = parseStreamReady(ready);
  assert.equal(readyP.sessionId, 's');

  const fin = packStreamFin({ sessionId: 's', ok: true });
  const finP = parseStreamFin(fin);
  assert.equal(finP.ok, true);
});

test('frames: invalid schema -> NC_FRAME_INVALID', () => {
  assert.throws(() => parseStreamInit({ type: STREAM.INIT, sessionId: '', totalBytes: 0 }), (e) => e instanceof NoisyError && e.code === 'NC_FRAME_INVALID');
  assert.throws(() => parseStreamData({ type: STREAM.DATA, sessionId: 's', seq: -1, chunk: 'AA' }), (e) => e.code === 'NC_FRAME_INVALID');
  assert.throws(() => parseStreamFin({ type: STREAM.FIN, sessionId: 's', ok: 'nope' }), (e) => e.code === 'NC_FRAME_INVALID');
});
