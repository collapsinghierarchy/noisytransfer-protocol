import { NoisyError } from "@noisytransfer/errors/noisy-error";

import { rtcInitiator } from "./initiator.js";
import { rtcResponder } from "./responder.js";

export function addEvt(target, type, cb) {
  target.addEventListener(type, cb);
  return () => target.removeEventListener(type, cb);
}

export function shouldAcceptCandidate(cand, { allowTcp = true, allowLoopbackV6 = false } = {}) {
  let s = "";
  if (typeof cand === "string") s = cand;
  else if (cand && typeof cand === "object") s = cand.candidate ?? "";
  if (!s) return false;
  if (!allowLoopbackV6 && s.includes("::1")) return false;
  if (!allowTcp && /\stcp\s/i.test(s)) return false;
  return true;
}

// Dependency-free helpers for DTLS fingerprint handling (ESM)

/**
 * Parse all DTLS fingerprints from an SDP blob.
 * Returns [{ alg: "SHA-256", bytes: Uint8Array }, ...] in encounter order.
 */
export function parseDtlsFingerprintsFromSdp(sdp) {
  if (!sdp || typeof sdp !== "string") return [];
  // a=fingerprint:SHA-256 AB:CD:EF:...
  const re = /^a=fingerprint:\s*([A-Za-z0-9-]+)\s+([0-9A-Fa-f:]+)\s*$/gim;
  const out = [];
  let m;
  while ((m = re.exec(sdp))) {
    const alg = m[1].toUpperCase();
    const hex = m[2].replace(/:/g, "");
    if (hex.length % 2) continue;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    out.push({ alg, bytes });
  }
  return out;
}

export function pickPreferredFingerprintFromSdp(
  sdp,
  preferred = ["SHA-256", "SHA-384", "SHA-512"]
) {
  const list = parseDtlsFingerprintsFromSdp(sdp);
  for (const p of preferred) {
    const hit = list.find((f) => f.alg === p);
    if (hit) return hit;
  }
  return list[0] || null;
}

export function getLocalFingerprintFromPC(pc) {
  const sdp = pc?.localDescription?.sdp ?? pc?.currentLocalDescription?.sdp ?? "";
  return pickPreferredFingerprintFromSdp(sdp);
}

export function getRemoteFingerprintFromPC(pc) {
  const sdp = pc?.remoteDescription?.sdp ?? pc?.currentRemoteDescription?.sdp ?? "";
  return pickPreferredFingerprintFromSdp(sdp);
}

// Gracefully close a PeerConnection (+ optional DataChannel) and detach handlers.
// Safe to call multiple times.
export async function hardCloseRTC(pc, { dc, timeout = 300 } = {}) {
  try {
    // Detach all handlers first to avoid retriggers
    if (pc) {
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.ondatachannel = null;
    }
    if (dc) {
      try {
        dc.onopen = dc.onmessage = dc.onclose = dc.onerror = null;
        if (dc.readyState !== "closed") dc.close();
      } catch {}
    }
    // Stop any tracks/transceivers (we don’t create tracks, but harmless)
    try {
      pc?.getSenders?.().forEach((s) => s.track && s.track.stop && s.track.stop());
    } catch {}
    try {
      pc?.getTransceivers?.().forEach((t) => t.stop && t.stop());
    } catch {}
    // Close the PC
    try {
      pc?.close?.();
    } catch {}

    // Wait a tick for wrtc to release timers/sockets
    await new Promise((r) => setTimeout(r, timeout));
  } catch {}
}

export async function dialRtcUntilReady({
  role,
  signal,
  rtcCfg = {},
  maxAttempts = 3,
  backoffMs = 200,
}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw;
    try {
      raw =
        role === "initiator"
          ? await rtcInitiator(signal, rtcCfg)
          : await rtcResponder(signal, rtcCfg);
      return { tx: raw, attempt };
    } catch (err) {
      lastErr = err;
      if (err?.code === "TRANSPORT_LOST_PRE_READY") {
        try {
          raw?.close?.();
        } catch {}
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
        continue;
      }
      try {
        raw?.close?.();
      } catch {}
      throw err;
    }
  }
  throw lastErr ?? new NoisyError({ code: "NC_PROTOCOL", message: "RTC: exhausted attempts" });
}
