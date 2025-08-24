import { binReplacer, binReviver } from "../ser.js";
import { asU8, isByteLike } from "@noisytransfer/util/buffer.js";
import { addEvt } from "./rtc-utils.js";

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

  function parseFingerprintsFromSDP(sdp) {
    const fps = [];
    const re = /^a=fingerprint:([A-Za-z0-9-]+)\s+([0-9A-F:]+)$/gmi;
    let m;
    while ((m = re.exec(sdp)) !== null) {
      const alg = m[1].toUpperCase();
      const hex = m[2].replace(/:/g, "");
      const u8 = new Uint8Array(hex.length / 2);
      for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
      fps.push({ alg, bytes: u8 });
    }
    return fps.find(f => f.alg === "SHA-256") || fps[0] || null;
  }

  // ---- event fanout (up/down/close) ----
  let isUp = (dc.readyState === "open");
  const ups = new Set();
  const downs = new Set();
  const closes = new Set();

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
  }

  // ---- DTLS fingerprint helpers expected by tests ----
  function getLocalFingerprint() {
    const sdp = pc.localDescription?.sdp || pc.currentLocalDescription?.sdp || "";
    return parseFingerprintsFromSDP(sdp);
  }
  function getRemoteFingerprint() {
    const sdp = pc.remoteDescription?.sdp || pc.currentRemoteDescription?.sdp || "";
    return parseFingerprintsFromSDP(sdp);
  }

  return {
    features: {
      durableOrdered: true,
      ordered: !!dc.ordered,
      reliable: (dc.maxPacketLifeTime == null && dc.maxRetransmits == null),
      // kept for backwards-compat; prefers SHA-256 from remote SDP
      peerFingerprints: () => {
        const sdp = pc.remoteDescription?.sdp || pc.currentRemoteDescription?.sdp || "";
        return parseFingerprintsFromSDP(sdp);
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

    onMessage: (cb) => addEvt(dc, "message", (ev) => {
      let payload = null;
      if (typeof ev.data === "string") payload = JSON.parse(ev.data, binReviver);
      else                             payload = asU8(ev.data);
      cb(payload);
    }),

    onUp:    (cb) => { ups.add(cb);    return () => ups.delete(cb); },
    onDown:  (cb) => { downs.add(cb);  return () => downs.delete(cb); },
    onClose: (cb) => { closes.add(cb); return () => closes.delete(cb); },

    close: (code = 1000, reason = "app_close") => {
      // best-effort drain, then close both dc & pc; also detach listeners
      const doClose = () => {
        cleanupListeners();
        try { dc.close(); } catch {}
        try { pc.close(); } catch {}
      };
      // avoid double close if already closing/closed
      if (dc.readyState === "closing" || dc.readyState === "closed") {
        doClose();
        return;
      }
      Promise.race([
        waitForDrain(dc),
        new Promise(r => setTimeout(r, 500)),
      ]).finally(doClose);
    },
  };
}