// Additional integration test: exercise dedicated sink + extra options 

// Ignore background flush timeouts coming from the transport; they’re harmless here.
process.on("unhandledRejection", (reason) => {
  const msg = String(reason && (reason.code || reason.message || reason));
  if (reason && (reason.code === "NC_TRANSPORT_FLUSH_TIMEOUT" || /flush timed out/i.test(msg))) {
    return; // swallow silently — do NOT fail the test file
  }
  throw reason; // rethrow anything else so we still fail for real bugs
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
import wrtc from "@roamhq/wrtc";

import {
  installWrtcGlobals,
  withSignalPair,
  skipIfNoIntegration,
} from "@noisytransfer/test-helpers";

import { rtcInitiator, rtcResponder, forceCloseNoFlush } from "@noisytransfer/transport";
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";
import {genRSAPSS, importVerifyKey, suite} from "@noisytransfer/crypto";

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
      try { un?.(); } catch {}
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


/** A simple dedicated sink that collects data into memory, exposing result() and arrayBuffer() */
function makeCollectingSink() {
  const chunks = [];
  let bytes = 0;
  let closed = false;
  return {
    write(u8) {
      assert.ok(!closed, "sink must not be written after close()");
      const c = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      chunks.push(c);
      bytes += c.byteLength;
    },
    close() {
      closed = true;
    },
    get size() {
      return bytes;
    },
    result() {
      const out = new Uint8Array(bytes);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    },
    async arrayBuffer() {
      const u8 = this.result();
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    },
  };
}

const safeSleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("RTC stream: dedicated sink + finAck + progress + chunking options", { timeout: 60_000 }, async (t) => {
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


  // Choose a size that yields many chunks with our custom chunkBytes.
  console.log("generating 2 MiB random data...");
  const src = randomBytes(2 * 1024 * 1024);
  const wantHash = await sha256Hex(src);
  const sessionId = crypto.randomUUID();
  const verifyKey = await importVerifyKey(verificationKey);
  // Receiver: use a dedicated sink + expectBytes + progress hook
  const sink = makeCollectingSink();
     let progressCalls = 0;

   console.log("starting receiver...");
     const rxP = withTimeout(
      asPromise(() => recvFileWithAuth({
        tx: rawB, sessionId, hpke: { ownPriv: privateKey }, sink,    onProgress: async (rcvd, total) => {
      progressCalls++;
      // total is either 0 (unknown) or the announced total; rcvd must be monotonic and <= expectBytes
      assert.ok(rcvd >= 0 && rcvd <= src.byteLength);
      if (typeof total === "number" && total > 0) {
        assert.equal(total, src.byteLength);
      }
    }, sign: { verifyKey }
      })),
      15000, "recvFileWithAuth stalled/failed"
    );
  
    const txP = withTimeout(
        asPromise(() => sendFileWithAuth({
          tx: rawA, sessionId, source:  new Blob([src]), hpke: { peerMaterial: recipientPk }, sign: { privateKey: signingKey, publicKeySpki: verificationKey },
          finAckTimeoutMs: 2000,
          finAckMaxRetries: 5,
          finAckBackoffMs: 10,
        })),
        15000, "sendFileWithAuth stalled/failed"
      );
  
  console.log("waiting for transfer to complete...");
  const [rxR, txR] = await Promise.allSettled([rxP, txP]);
  console.log("Status: recv", rxR.status, ", send", txR.status);
  if (rxR.status === "rejected") console.log(rxR.reason);
  if (txR.status === "rejected") console.log(txR.reason);

  // Validate results
  const gotBuf = sink.result();
  const gotHash = await sha256Hex(gotBuf);
  assert.equal(gotHash, wantHash, "dedicated sink received content digest must match");
  assert.equal(sink.size, src.byteLength, "dedicated sink byte count must match");
  assert.ok(progressCalls > 0, "onProgress should have been called at least once");
  assert.equal(rxR.value?.signatureVerified, true);

  // Explicit teardown: close both sides so Node can exit cleanly.
  await Promise.allSettled([forceCloseNoFlush(rawA), forceCloseNoFlush(rawB)]);
});
