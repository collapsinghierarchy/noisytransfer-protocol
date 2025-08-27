import { asU8, isByteLike } from "@noisytransfer/util/buffer";

import { binReplacer, binReviver } from "../ser.js";
import {
  addEvt,
  pickPreferredFingerprintFromSdp,
  parseDtlsFingerprintsFromSdp,
  hardCloseRTC,
} from "./rtc-utils.js";

/** Resolve when the DataChannel TX buffer is empty. */
export function waitForDrain(dc) {
  return new Promise((res) => {
    if (!dc || dc.readyState !== "open" || dc.bufferedAmount === 0) return res();
    dc.bufferedAmountLowThreshold = 0;
    const h = () => {
      if (dc.bufferedAmount === 0) {
        dc.removeEventListener("bufferedamountlow", h);
        res();
      }
    };
    dc.addEventListener("bufferedamountlow", h);
  });
}

/** Wraps a DataChannel with our transport surface (send/onMessage/onUp/onDown/onClose/close + features). */
export function wrapDataChannel(dc, pc, side = "") {
  const tag = side ? `[DC:${side}]` : "[DC]";
  dc.binaryType = "arraybuffer";

  // ---- event fanout (up/down/close) ----
  let isUp = (dc.readyState === "open");
  const ups = new Set();
  const downs = new Set();
  const closes = new Set();
  const msgUnsubs = new Set();

  const unOpen = addEvt(dc, "open", () => {
    if (!isUp) {
      isUp = true;
      for (const cb of ups) { try { cb(); } catch {} }
    }
  });

  const unError = addEvt(dc, "error", () => {
    // treat errors as "down" signals if we were up
    if (isUp) {
      isUp = false;
      for (const cb of downs) { try { cb(); } catch {} }
    }
  });

  const unClose = addEvt(dc, "close", () => {
    if (isUp) {
      isUp = false;
      for (const cb of downs) { try { cb(); } catch {} }
    }
    for (const cb of closes) { try { cb(); } catch {} }
  });

  const unConn = addEvt(pc, "connectionstatechange", () => {
    const st = pc.connectionState;
    if ((st === "disconnected" || st === "failed") && isUp) {
      isUp = false;
      for (const cb of downs) { try { cb(); } catch {} }
    }
    if (st === "closed") {
      for (const cb of closes) { try { cb(); } catch {} }
    }
  });

  function cleanupListeners() {
    try { unOpen?.(); } catch {}
    try { unError?.(); } catch {}
    try { unClose?.(); } catch {}
    try { unConn?.(); } catch {}
    try { for (const un of msgUnsubs) { try { un(); } catch {} } msgUnsubs.clear(); } catch {}
    try { dc.onmessage = null; } catch {}
  }

  // ---- DTLS fingerprint helpers expected by tests ----
  function getLocalFingerprint() {
    const sdp = pc.localDescription?.sdp || pc.currentLocalDescription?.sdp || "";
    return pickPreferredFingerprintFromSdp(sdp);
  }
  function getRemoteFingerprint() {
    const sdp = pc.remoteDescription?.sdp || pc.currentRemoteDescription?.sdp || "";
    return pickPreferredFingerprintFromSdp(sdp);
  }

  return {
    features: {
      durableOrdered: true,
      ordered: !!dc.ordered,
      reliable: (dc.maxPacketLifeTime == null && dc.maxRetransmits == null),
      // kept for backwards-compat; prefers SHA-256 from remote SDP
      peerFingerprints: () => {
        const sdp = pc.remoteDescription?.sdp || pc.currentRemoteDescription?.sdp || "";
        return parseDtlsFingerprintsFromSdp(sdp);
      },
    },

    get isUp() { return isUp; },

    getLocalFingerprint,
    getRemoteFingerprint,
    send: (data) => {
      if (isByteLike(data)) {
        const u8 = asU8(data);
        try { dc.send(u8); }
        catch { dc.send(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); }
        return;
      }
      dc.send(JSON.stringify(data, binReplacer));
    },

    onMessage: (cb) => {
      const un = addEvt(dc, "message", (ev) => {
        let payload = null;
        if (typeof ev.data === "string") payload = JSON.parse(ev.data, binReviver);
        else                             payload = asU8(ev.data);
        cb(payload);
      });
      msgUnsubs.add(un);
      return () => { try { un(); } finally { msgUnsubs.delete(un); } };
    },

    onUp:    (cb) => { ups.add(cb);    return () => ups.delete(cb); },
    onDown:  (cb) => { downs.add(cb);  return () => downs.delete(cb); },
    onClose: (cb) => { closes.add(cb); return () => closes.delete(cb); },

   close: async (code = 1000, reason = "app_close") => {
      cleanupListeners();
      try {
        if (dc && dc.readyState === "open") {
          try { dc.bufferedAmountLowThreshold = 0; } catch {}
          await Promise.race([
            waitForDrain(dc),
            new Promise(r => setTimeout(r, 200))
          ]);
        }
      } catch {}
      await hardCloseRTC(pc, { dc });
    },
  };
}