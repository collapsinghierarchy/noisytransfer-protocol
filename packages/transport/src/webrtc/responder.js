// packages/transport/src/webrtc/responder.js
import { NoisyError } from "@noisytransfer/errors/noisy-error";

import { isTransport } from "../core.js";
 import {
   shouldAcceptCandidate,
   getLocalFingerprintFromPC,
   getRemoteFingerprintFromPC
 } from "./rtc-utils.js";


/**
 * Return a Transport facade immediately; connect later when an offer arrives
 * over the signalling transport. Until the DataChannel is open, send() throws
 * NC_TRANSPORT_DOWN and isConnected = false.
 */
export function rtcResponder(signal, rtcCfg = {}) {
  if (!isTransport(signal)) {
    throw new NoisyError({ code: "NC_PROTOCOL", message: "rtcResponder: 'signal' must be a Transport" });
  }

  // ---- transport facade (immediate) ---------------------------------------
  let connected = false;
  const onUpHandlers = new Set();
  const onDownHandlers = new Set();
  const onCloseHandlers = new Set();
  const onMessageHandlers = new Set();

  const tx = {
    get isConnected() { return connected; },
    // Optional alias for symmetry with any “isUp” usage elsewhere:
    get isUp() { return connected; },
    onUp(cb)    { onUpHandlers.add(cb);    return () => onUpHandlers.delete(cb); },
    onDown(cb)  { onDownHandlers.add(cb);  return () => onDownHandlers.delete(cb); },
    onClose(cb) { onCloseHandlers.add(cb); return () => onCloseHandlers.delete(cb); },
    onMessage(cb){ onMessageHandlers.add(cb); return () => onMessageHandlers.delete(cb); },
    // Expose DTLS fingerprint helpers immediately. They return null until SDP is set.
    getLocalFingerprint()  { return getLocalFingerprintFromPC(pc); },
    getRemoteFingerprint() { return getRemoteFingerprintFromPC(pc); },
    send(_) {
      throw new NoisyError({ code: "NC_TRANSPORT_DOWN", message: "RTC DataChannel not open" });
    },
    close(code = 1000, reason = "closed") {
      try { pc?.close?.(); } catch {}
      setConnected(false);
      fireClose({ code, reason });
    },
  };

  function fireUp()   { for (const f of [...onUpHandlers])   try { f(); } catch {} }
  function fireDown() { for (const f of [...onDownHandlers]) try { f(); } catch {} }
  function fireClose(ev) { for (const f of [...onCloseHandlers]) try { f(ev); } catch {} }
  function emitMessage(m) { for (const f of [...onMessageHandlers]) try { f(m); } catch {} }
  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    v ? fireUp() : fireDown();
  }

  // ---- lazy RTC wiring (on first offer) -----------------------------------
  let pc = null;
  let dc = null;
  let unsubSignal = null;
  let iceUnsub = null;

  const ICE_TIMEOUT_MS = Number(
    (globalThis?.NOISY_RTC_ICE_TIMEOUT_MS ?? process?.env?.NOISY_RTC_ICE_TIMEOUT_MS) ?? 15000
  );
  let iceTimer = null;

  function armIceWatchdog() {
    clearTimeout(iceTimer);
    if (ICE_TIMEOUT_MS > 0) {
      iceTimer = setTimeout(() => {
        // timeout before DC open — just mark down & close facade
        try { pc?.close?.(); } catch {}
        setConnected(false);
        fireClose({ code: 1011, reason: "NC_RTC_ICE_TIMEOUT" });
      }, ICE_TIMEOUT_MS);
    }
  }

  function clearIceWatchdog() { clearTimeout(iceTimer); iceTimer = null; }

  async function handleOffer(offerMsg) {
    try {
      if (!pc) {
        pc = new RTCPeerConnection(rtcCfg);

        // Outgoing ICE
        pc.onicecandidate = (ev) => {
          const c = ev?.candidate;
          if (!c) return; // sentinel
          const candObj = c.toJSON?.() ?? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
          if (typeof shouldAcceptCandidate === "function" && !shouldAcceptCandidate(candObj, { allowTcp: false, allowLoopbackV6: false })) {
            return;
          }
          signal.send({ type: "ice", cand: candObj });
        };

        // Incoming ICE (subscribe now; we’ll keep it until close)
        iceUnsub = signal.onMessage((m) => {
          if (!m || m.type !== "ice") return;
          const cand = m.cand ?? m.candidate;
          if (!cand) return;
          try { pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
        });

        // DataChannel from initiator
        pc.ondatachannel = (ev) => {
          dc = ev.channel;
          dc.binaryType = "arraybuffer";

          dc.onopen = () => {
            clearIceWatchdog();
            // upgrade facade: real send & message path
            tx.send = (payload) => {
              const out = (typeof payload === "string" || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload))
                ? payload
                : JSON.stringify(payload);
              dc.send(out);
            };
            dc.onmessage = (e) => {
              let v = e.data;
              if (typeof v === "string") { try { v = JSON.parse(v); } catch {} }
              emitMessage(v);
            };
            setConnected(true);
            // no more trickle needed after open
            try { pc.onicecandidate = null; } catch {}
          };

          dc.onclose = () => {
            setConnected(false);
            fireClose({ code: 1000, reason: "dc closed" });
          };

          dc.onerror = () => {
            setConnected(false);
            fireClose({ code: 1011, reason: "dc error" });
          };
        };
      }

      // Apply offer & send answer
      const offer = offerMsg.offer ?? offerMsg.sdp;
      await pc.setRemoteDescription(
        offer?.type ? offer : new RTCSessionDescription(offer)
      );

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const ld = pc.localDescription;
      signal.send({ type: "answer", sdp: { type: ld.type, sdp: ld.sdp } });

      // Start ICE watchdog once we’re actively negotiating
      armIceWatchdog();
    } catch (e) {
      // Surface as a transport close; consumer side will observe onClose/onDown
      try { pc?.close?.(); } catch {}
      setConnected(false);
      fireClose({ code: 1011, reason: String(e?.message || e) });
    }
  }

  // Listen for signalling; trigger on 'offer'
  unsubSignal = signal.onMessage((m) => {
    if (!m || typeof m !== "object") return;
    if (m.type === "offer" && (m.offer || m.sdp)) {
      try { unsubSignal?.(); } catch {}
      handleOffer(m);
    }
  });

  // Teardown wiring when facade closes
  tx.onClose(() => {
    clearIceWatchdog();
    try { unsubSignal?.(); } catch {}
    try { iceUnsub?.(); } catch {}
    try { pc?.close?.(); } catch {}
  });

  return tx; // immediate
}
