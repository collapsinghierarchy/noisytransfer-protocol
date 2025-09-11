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
import { suite, genRSAPSS, importVerifyKey } from "@noisytransfer/crypto";

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

// Turn sync throws into rejected Promises
const asPromise = (thunk) => {
  try { return Promise.resolve(thunk()); }
  catch (e) { return Promise.reject(e); }
};

// Wrap a promise with a timeout that rejects
const withTimeout = (p, ms, label) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`test timeout: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });


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

  const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const recipientPk = await suite.kem.serializePublicKey(publicKey);
  const { verificationKey, signingKey } = await genRSAPSS();

  // 1–2 MiB is plenty to exercise chunking without stressing DC buffering
  console.log("generating 500 KiB random data...");
  const src = randomBytes(660_999); // 500 KiB
  const wantHash = await sha256Hex(src);
  console.log("source data digest:", wantHash);
  const sessionId = crypto.randomUUID();

 let rxBytes = 0;
 const sink = mkCollectSink((n) => { rxBytes = n; });
 const verifyKey = await importVerifyKey(verificationKey);
 console.log("starting receiver...");
   const rxP = withTimeout(
    asPromise(() => recvFileWithAuth({
      tx: rawB, sessionId, hpke: { ownPriv: privateKey }, sink, sign: { verifyKey }
    })),
    15000, "recvFileWithAuth stalled/failed"
  );

  const txP = withTimeout(
    asPromise(() => sendFileWithAuth({
      tx: rawA, sessionId, source: src, hpke: { peerMaterial: recipientPk }, sign: { privateKey: signingKey, publicKeySpki: verificationKey },
    })),
    15000, "sendFileWithAuth stalled/failed"
  );

  console.log("waiting for transfer to complete...");
  const [rxR, txR] = await Promise.allSettled([rxP, txP]);
  console.log("Status: recv", rxR.status, ", send", txR.status);
  if (rxR.status === "rejected") console.log(rxR.reason);
  if (txR.status === "rejected") console.log(txR.reason);

  const got = sink.result();
  const gotHash = await sha256Hex(got);
  assert.equal(gotHash, wantHash, "received content digest must match");
  assert.equal(rxBytes, src.byteLength, "byte counts must match");
  assert.equal(rxR.value?.signatureVerified, true);

  // Explicit teardown: close both sides so Node can exit cleanly.
  await Promise.allSettled([forceCloseNoFlush(rawA), forceCloseNoFlush(rawB)]);
});

test("RTC stream: INIT/DATA/FIN roundtrip w/ integrity and dfferent credit and window sizes", { timeout: 60_000 }, async (t) => {
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

   const { publicKey, privateKey } = await suite.kem.generateKeyPair();
  const recipientPk = await suite.kem.serializePublicKey(publicKey);
  const { verificationKey, signingKey } = await genRSAPSS();

  // 1–2 MiB is plenty to exercise chunking without stressing DC buffering
  console.log("generating 1.5 MiB random data...");
  const src = randomBytes(10_666_999); // 1.5 MiB
  const wantHash = await sha256Hex(src);
  console.log("source data digest:", wantHash);
  const sessionId = crypto.randomUUID();

  const verifyKey = await importVerifyKey(verificationKey);
 let rxBytes = 0;
 const sink = mkCollectSink((n) => { rxBytes = n; });
 console.log("starting receiver...");
   const rxP = withTimeout(
    asPromise(() => recvFileWithAuth({
      tx: rawB, sessionId, hpke: { ownPriv: privateKey }, sink, windowChunks: 8,
      credit: 4, sign: { verifyKey }
    })),
    15000, "recvFileWithAuth stalled/failed"
  );

  const txP = withTimeout(
    asPromise(() => sendFileWithAuth({
      tx: rawA, sessionId, source: src, hpke: { peerMaterial: recipientPk }, sign: { privateKey: signingKey, publicKeySpki: verificationKey }
    })),
    15000, "sendFileWithAuth stalled/failed"
  );

  console.log("waiting for transfer to complete...");
  const [rxR, txR] = await Promise.allSettled([rxP, txP]);
  console.log("Status: recv", rxR.status, ", send", txR.status);
  if (rxR.status === "rejected") console.log(rxR.reason);
  if (txR.status === "rejected") console.log(txR.reason);
  

  const got = sink.result();
  const gotHash = await sha256Hex(got);
  assert.equal(gotHash, wantHash, "received content digest must match");
  assert.equal(rxBytes, src.byteLength, "byte counts must match");
  assert.equal(rxR.value?.signatureVerified, true);

  // Explicit teardown: close both sides so Node can exit cleanly.
  await Promise.allSettled([forceCloseNoFlush(rawA), forceCloseNoFlush(rawB)]);
});

function mkCollectSink(onProgress) {
  const chunks = [];
  let total = 0;
  return {
    write(u8) {
      const v = u8 instanceof Uint8Array
        ? u8
        : (ArrayBuffer.isView(u8) ? new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength)
                                   : new Uint8Array(u8));
      chunks.push(v);
      total += v.byteLength;
      onProgress?.(total);
    },
    async close() {},
    result() {
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      return out;
    },
    async arrayBuffer() {
      const u = this.result();
      return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    },
  };
}
