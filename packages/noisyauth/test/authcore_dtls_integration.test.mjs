import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "wrtc";
globalThis.RTCPeerConnection     ??= wrtc.RTCPeerConnection;
globalThis.RTCIceCandidate       ??= wrtc.RTCIceCandidate;
globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;

import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { browserWSWithReconnect } from "@noisytransfer/transport/ws/ws.js";
import { rtcInitiator, rtcResponder } from "@noisytransfer/transport/webrtc/index.js";

import { createAuthSender } from "@noisytransfer/noisyauth/sender.js";
import { createAuthReceiver } from "@noisytransfer/noisyauth/receiver.js";

import {
  STREAM,
  packStreamInit,
  packStreamData,
  parseStreamData,
} from "@noisytransfer/noisystream/frames.js";
import { b64u as bytesToB64u, unb64u as b64uToBytes} from "@noisytransfer/util/base64.js"
import * as sig from "@noisytransfer/crypto/signature.js";

const CHUNK = 64 * 1024;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function randomBytes(n) {
  const u = new Uint8Array(n);
  for (let i=0;i<n;i++) u[i] = (Math.random()*256)|0;
  return u;
}
async function sha256Hex(u8) {
  const view = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const d = await crypto.subtle.digest("SHA-256", view);
  return Buffer.from(d).toString("hex");
}

/* ------------------------ signaling over your backend ------------------------ */
async function makeSignal(room, side) {
  const url = `ws://localhost:1234/ws?appID=${room}&side=${side}`;
  const wsTx = browserWSWithReconnect(url, { maxRetries: 2 });

  const outQ = [];
  const flush = () => {
    while (outQ.length && wsTx.isConnected) {
      const m = outQ.shift();
      try { wsTx.send(m); } catch { outQ.unshift(m); break; }
    }
  };
  wsTx.onUp(flush);

  return {
    send: m => { if (wsTx.isConnected) wsTx.send(m); else outQ.push(m); },
    close: (...a) => wsTx.close(...a),
    onMessage: cb => wsTx.onMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "offer": case "answer": case "ice": cb(msg); break;
        default: /* ignore */ ;
      }
    }),
    onClose: cb => wsTx.onClose(cb),
  };
}

/* --------------------------------- dial RTC -------------------------------- */
async function dial(role, signal, rtcCfg = {}) {
  return role === "initiator" ? rtcInitiator(signal, rtcCfg)
                              : rtcResponder(signal, rtcCfg);
}

/* ----------------------------------- test ---------------------------------- */

test("DTLS-auth via SAS + cleartext stream over RTC DC (no PQ)", { timeout: 60_000 }, async () => {
  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const [sigA, sigB] = await Promise.all([makeSignal(room, "A"), makeSignal(room, "B")]);
  const [rawA, rawB] = await Promise.all([
    dial("initiator", sigA, { iceServers: [] }),
    dial("responder", sigB, { iceServers: [] }),
  ]);

  // Sanity: wrapper must expose DTLS fingerprint helpers
  assert.equal(typeof rawA.getLocalFingerprint, "function", "rawA.getLocalFingerprint() missing");
  assert.equal(typeof rawA.getRemoteFingerprint, "function", "rawA.getRemoteFingerprint() missing");
  assert.equal(typeof rawB.getLocalFingerprint, "function", "rawB.getLocalFingerprint() missing");
  assert.equal(typeof rawB.getRemoteFingerprint, "function", "rawB.getRemoteFingerprint() missing");

  // 1) Grab DTLS fingerprints (SHA-256) from SDP on both sides
  const fpA_local  = rawA.getLocalFingerprint();   // sender local
  const fpA_remote = rawA.getRemoteFingerprint();  // sender view of receiver
  const fpB_local  = rawB.getLocalFingerprint();   // receiver local
  const fpB_remote = rawB.getRemoteFingerprint();  // receiver view of sender

  assert.ok(fpA_local && fpA_remote && fpB_local && fpB_remote, "missing fingerprints");
  assert.equal(fpA_local.alg, "SHA-256");          // we pick SHA-256
  assert.equal(fpB_local.alg, "SHA-256");
  // Cross-check perspectives
  assert.equal(Buffer.compare(Buffer.from(fpA_local.bytes),  Buffer.from(fpB_remote.bytes)), 0, "A.local != B.remote");
  assert.equal(Buffer.compare(Buffer.from(fpA_remote.bytes), Buffer.from(fpB_local.bytes)),  0, "A.remote != B.local");

  // 2) Use fingerprints as SAS/auth messages
  const senderMsgS = fpA_local.bytes;  // what the sender advertises
  const recvMsgR   = fpB_local.bytes;  // what the receiver advertises

  // 3) Content integrity keys (RSA-PSS)
  const { signingKey, verificationKey } = await sig.genRSAPSS();
  const verifyKey = await crypto.subtle.importKey(
    "spki",
    verificationKey,
    { name: "RSA-PSS", hash: "SHA-256" },
    true,
    ["verify"]
  );

  // 4) Start receiver auth
  let rxStarted = false;
  const rxChunks = [];
  const rxDone = new Promise((resolve, reject) => {
    createAuthReceiver(rawB, {
      onSAS: () => {},
      waitConfirm: () => true,
      onDone: async ({ msgS }) => {
        try {
          const s = typeof msgS === "string" ? b64uToBytes(msgS) : new Uint8Array(msgS);
          assert.equal(Buffer.compare(Buffer.from(s), Buffer.from(senderMsgS)), 0, "sender fp mismatch");

          // Wire DataChannel for streaming (cleartext frames)
          rawB.onMessage(async (m) => {
            try {
              if (!m) return;
              if (typeof m === "object" && m.type === STREAM.INIT) {
                rxStarted = true;
                return;
              }
              if (typeof m === "object" && m.type === STREAM.DATA) {
                const { chunk } = parseStreamData(m); // Uint8Array
                rxChunks.push(chunk);
                return;
              }
              if (typeof m === "object" && m.type === STREAM.FIN) {
                // We attach extra fields on FIN (signature + digest) for this test.
                const signature = b64uToBytes(m.signature);
                const declaredDigest = b64uToBytes(m.digest);
                // concatenate received plaintext pieces and verify final signature
                const out = Buffer.concat(rxChunks.map(Buffer.from));
                const digest = await crypto.subtle.digest("SHA-256", out);
                assert.equal(Buffer.compare(Buffer.from(declaredDigest), Buffer.from(digest)), 0, "declared digest mismatch");
                const ok = await sig.verifyChunk(verifyKey, signature, digest);
                assert.ok(ok, "final signature verify failed");
                resolve();
                return;
              }
            } catch (e) {
              reject(e);
            }
          });
        } catch (e) {
          reject(e);
        }
      },
      onError: reject,
    }, { policy: "rtc", sessionId, recvMsg: recvMsgR });
  });

  // 5) Sender auth
  await new Promise((resolve, reject) => {
    createAuthSender(rawA, {
      onSAS: () => {},
      waitConfirm: () => true,
      onDone: ({ msgR }) => {
        const r = typeof msgR === "string" ? b64uToBytes(msgR) : new Uint8Array(msgR);
        assert.equal(Buffer.compare(Buffer.from(r), Buffer.from(recvMsgR)), 0, "receiver fp mismatch");
        resolve();
      },
      onError: reject,
    }, { policy: "rtc", sessionId, sendMsg: senderMsgS });
  });

  // 6) Stream a multi-chunk payload (plaintext frames, signed at the end)
  const TOTAL = 3_407_872; // ~3.25 MiB
  const src = randomBytes(TOTAL);
  const srcHash = await sha256Hex(src);

  // Announce stream (cleartext; use ns_init)
  rawA.send(packStreamInit({ sessionId, totalBytes: TOTAL }));

  // Send plaintext frames (ns_data; 'chunk' carries plaintext)
  const chunks = [];
  for (let off = 0, seq = 0; off < src.length; off += CHUNK, seq++) {
    const piece = src.subarray(off, Math.min(off + CHUNK, src.length));
    chunks.push(piece);
    rawA.send(packStreamData({ sessionId, seq, chunk: piece }));
  }

  // Finalize: sign digest of plaintext
  const digest = await crypto.subtle.digest("SHA-256",
    Buffer.concat(chunks.map(Buffer.from))
  );
  const signature = await sig.signChunk(signingKey, digest);

  // FIN: use ns_fin + attach extra fields (signature + digest) for this test
  rawA.send({
    type: STREAM.FIN,
    sessionId,
    ok: true,
    signature: bytesToB64u(signature),
    digest: bytesToB64u(new Uint8Array(digest)),
  });

  // 7) Wait for receiver, check integrity
  await rxDone;
  assert.ok(rxStarted, "receiver did not see stream_init");

  const out = Buffer.concat(rxChunks.map(Buffer.from));
  assert.equal(out.length, TOTAL, "received length mismatch");
  const outHash = await sha256Hex(new Uint8Array(out));
  assert.equal(outHash, srcHash, "content hash mismatch");

  // Cleanup
  await sleep(50);
  try { await rawA.close?.(); } catch {}
  try { await rawB.close?.(); } catch {}
  try { sigA?.close?.(); } catch {}
  try { sigB?.close?.(); } catch {}
});
