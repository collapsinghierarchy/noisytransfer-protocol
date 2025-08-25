#!/usr/bin/env node

/* eslint-disable no-console */
import { webcrypto } from "node:crypto";
globalThis.crypto ??= webcrypto;

import wrtc from "@roamhq/wrtc";
globalThis.RTCPeerConnection     ??= wrtc.RTCPeerConnection;
globalThis.RTCIceCandidate       ??= wrtc.RTCIceCandidate;
globalThis.RTCSessionDescription ??= wrtc.RTCSessionDescription;

import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import fs from "node:fs";
import { once } from "node:events";

import { rtcInitiator, rtcResponder } from "@noisytransfer/transport";
import { createAuthSender, createAuthReceiver } from "@noisytransfer/noisyauth";
import { sendFileWithAuth, recvFileWithAuth } from "@noisytransfer/noisystream";
import { suite } from "@noisytransfer/crypto";
import { encodeLink, decodeLink } from "../src/link.js";
import { makeSignal } from "../src/signal.js";

// ---------- tiny util ----------
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i+1] ?? "") : def;
};
const has = (name) => process.argv.includes(name);

// Defaults (override with env or flags)
const SIGNAL_URL = process.env.NOISY_SIGNAL_URL || arg("--signal", "ws://localhost:1234/ws");
const STUN_URLS  = (process.env.NOISY_STUNS || arg("--stun", "stun:stun.l.google.com:19302"))
  .split(",").map(s => s.trim()).filter(Boolean);
const ICE_CFG    = { iceServers: STUN_URLS.length ? STUN_URLS.map(u => ({ urls:u })) : [] };
const OUT_PATH   = arg("--out", "received.bin");
const PQ         = has("--pq");              // enable PQ auth path (optional)
const NO_CONFIRM = has("--no-confirm");      // skip SAS confirmation prompt

function usage() {
  console.log(`Usage:
  noisy send <file> [--signal ws://host:port/ws] [--stun stun:host:port[,stun:...]] [--pq] [--no-confirm]
  noisy recv <link> [--signal ws://host:port/ws] [--stun ...] [--out ./path] [--pq] [--no-confirm]
`);
}

function promptYes(msg) {
  if (NO_CONFIRM) return Promise.resolve(true);
  process.stdout.write(`${msg} Confirm? [y/N] `);
  return new Promise((res) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => res(/^y(es)?$/i.test(String(d).trim())));
  });
}

async function dial(role, signal) {
  return role === "initiator" ? rtcInitiator(signal, ICE_CFG)
                              : rtcResponder(signal, ICE_CFG);
}

function fmtBytes(n) {
  const u = ["B","KB","MB","GB","TB"];
  let i = 0; let x = Number(n);
  while (x >= 1024 && i < u.length-1) { x /= 1024; i++; }
  return `${x.toFixed(1)} ${u[i]}`;
}

async function genReceiverMsgPQ() {
  const kp = await suite.kem.generateKeyPair();
  const pub = await suite.kem.serializePublicKey(kp.publicKey);
  return { recvMsg: pub, kp };
}

async function genSenderVerifyKeyPQ() {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1,0,1]), hash:"SHA-256" },
    true, ["sign","verify"]
  );
  return crypto.subtle.exportKey("spki", publicKey);
}

// ------------- commands -------------
async function cmdSend(filePath) {
  if (!filePath) { usage(); process.exit(2); }
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);

  const room = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const sigTx = makeSignal(SIGNAL_URL, room, "A");
  const raw   = await dial("initiator", sigTx);

  // Build sender "auth message" (DTLS fingerprint path by default).
  const sendMsg = PQ ? await genSenderVerifyKeyPQ()
                     : raw.getLocalFingerprint().bytes;

  // Print the link right away (so the other side can start)
  const link = encodeLink({ room, sessionId, signalUrl: SIGNAL_URL, pq: PQ });
  console.log(link);

  // Show SAS for out-of-band comparison
  let sas = "";
  await new Promise((resolve, reject) => {
    createAuthSender(raw, {
      onSAS: (s) => { sas = s; console.error(`SAS: ${s}`); },
      waitConfirm: async () => {
        const ok = await promptYes("Do both sides show the same SAS?");
        return !!ok;
      },
      onDone: resolve,
      onError: reject
    }, { policy: "rtc", sessionId, sendMsg });
  });

  // Stream the file
  const rs = fs.createReadStream(filePath);
  let last = Date.now(), sent = 0;
  await sendFileWithAuth({
    tx: raw,
    sessionId,
    source: rs,
    onProgress: (n, total) => {
      const now = Date.now();
      if (now - last > 400) {
        process.stderr.write(`\r↑ ${fmtBytes(n)} / ${fmtBytes(total ?? stat.size)}`);
        last = now; sent = n;
      }
    }
  });
  process.stderr.write(`\r↑ ${fmtBytes(sent)} / ${fmtBytes(stat.size)}\n`);
  try { await raw.close?.(); } catch {}
  try { await sigTx.close?.(); } catch {}
}

async function cmdRecv(link) {
  if (!link) { usage(); process.exit(2); }
  const { r:room, s:sessionId, u:signalUrl = SIGNAL_URL, pq } = decodeLink(link);

  const sigTx = makeSignal(signalUrl, room, "B");
  const raw   = await dial("responder", sigTx);

  // Build receiver "auth message"
  let recvMsg, pqKp;
  if (PQ || pq) {
    const { recvMsg: pub, kp } = await genReceiverMsgPQ();
    recvMsg = pub; pqKp = kp; // kp reserved if you want to extend later
  } else {
    recvMsg = raw.getLocalFingerprint().bytes;
  }

  let sas = "";
  await new Promise((resolve, reject) => {
    createAuthReceiver(raw, {
      onSAS: (s) => { sas = s; console.error(`SAS: ${s}`); },
      waitConfirm: async () => {
        const ok = await promptYes("Do both sides show the same SAS?");
        return !!ok;
      },
      onDone: resolve,
      onError: reject
    }, { policy: "rtc", sessionId, recvMsg });
  });

  // Receive to disk
  const ws = fs.createWriteStream(OUT_PATH);
  const sink = {
    write: async (u8) => ws.write(Buffer.from(u8)),
    close: async () => { ws.end(); await once(ws, "close"); }
  };
  let last = Date.now(), got = 0, expect;
  await recvFileWithAuth({
    tx: raw,
    sessionId,
    sink,
    onProgress: (n, total) => {
      expect = total ?? expect;
      const now = Date.now();
      if (now - last > 400) {
        process.stderr.write(`\r↓ ${fmtBytes(n)}${expect ? ` / ${fmtBytes(expect)}` : ""}`);
        last = now; got = n;
      }
    }
  });
  process.stderr.write(`\r↓ ${fmtBytes(got)}${expect ? ` / ${fmtBytes(expect)}` : ""}\n`);
  console.error(`Saved to ${OUT_PATH}`);
  try { await raw.close?.(); } catch {}
  try { await sigTx.close?.(); } catch {}
}

// Entrypoint
(async () => {
  const [,, sub, arg1] = process.argv;
  if (sub === "send") return void (await cmdSend(arg1));
  if (sub === "recv") return void (await cmdRecv(arg1));
  usage(); process.exit(1);
})();
