import { shouldAcceptCandidate } from "./rtc-utils.js";
import { wrapDataChannel } from "./dc.js";
import { isTransport } from "../index.js";
import { NoisyError } from "@noisytransfer/errors/noisy-error.js";
import { logger } from "@noisytransfer/util/logger.js";

// Note: JSON (de)serialiser used inside wrapDataChannel via common.js

export function rtcInitiator(signal, rtcCfg = { iceServers: [] }) {
  if (!isTransport(signal)) {
    throw new NoisyError({ code: "NC_PROTOCOL", message: "rtcInitiator: 'signal' must be a Transport" });
  }

  return new Promise(async (resolve, reject) => {
    const ICE_TIMEOUT_MS = Number((globalThis?.NOISY_RTC_ICE_TIMEOUT_MS ?? process?.env?.NOISY_RTC_ICE_TIMEOUT_MS) ?? 15000);
    const pc = new RTCPeerConnection(rtcCfg);

    let lastConn = null;
    pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        try { unsubSignal?.(); } catch {}
        pc.onicecandidate = null;
    }
    });

   // — DEBUG only: wrap SDP setters to log when NOISY_DEBUG_RTC is enabled —
  const __DEBUG_RTC = (typeof process !== 'undefined' && process.env && process.env.NOISY_DEBUG_RTC)
    || (typeof globalThis !== 'undefined' && globalThis.NOISY_DEBUG_RTC);
   if (__DEBUG_RTC) {
     const origSetRemote = pc.setRemoteDescription.bind(pc);
     pc.setRemoteDescription = async (desc) => {
       const r = await origSetRemote(desc);
       logger.debug("🔄 setRemoteDescription:", r);
       return r;
     };
     const origSetLocal = pc.setLocalDescription.bind(pc);
     pc.setLocalDescription = async (desc) => {
       const r = await origSetLocal(desc);
       logger.debug("🔄 setLocalDescription:", r);
       return r;
     };
   }

    const pending = [];
    let haveRemote = false;

    const unsubSignal = signal.onMessage(async (m) => {
      if (m?.type === "answer") {
        try { await pc.setRemoteDescription(m.sdp); }
        catch (err) { throw new NoisyError({ code: "NC_RTC_SDP_FAILED", message: "setRemoteDescription failed", context: { phase: "remote" }, cause: err }); }
        haveRemote = true;
        // drain any ICE that arrived early (including the null sentinel)
        while (pending.length) await pc.addIceCandidate(pending.shift());
      } else if (m?.type === "ice") {
        if (!m.cand) return; // ignore end-of-candidates   
        if (!haveRemote) pending.push(m.cand);
        else await pc.addIceCandidate(m.cand);
      }
    });

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return; // don't send sentinel in Node/wrtc
      const candObj = ev.candidate.toJSON?.() ?? {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex
      };
      if (!shouldAcceptCandidate(candObj, { allowTcp: false, allowLoopbackV6: false })) return;
      signal.send({ type: "ice", cand: candObj });
    };


    try {
    // 3) responder replies "ready" (see below). Only after that, create offer & trickle:
    const dc = pc.createDataChannel("data", { ordered: true });

    // --- DC open watchdog: reject if we never open
    let iceTimer = setTimeout(() => {
      try { pc.onicecandidate = null; } catch {}
      try { unsubSignal?.(); } catch {}
      reject(new NoisyError({
        code: "NC_RTC_ICE_TIMEOUT",
        message: "ICE timed out before datachannel open",
        context: { timeoutMs: ICE_TIMEOUT_MS, role: "initiator" },
        retriable: true,
      }));
    }, ICE_TIMEOUT_MS);



    dc.addEventListener("open", () => {
      pc.onicecandidate = null;     // stop trickling
      try { unsubSignal?.(); } catch {}
      try { clearTimeout(iceTimer); } catch {}
      resolve(wrapDataChannel(dc, pc, "Initiator"));
    });

    dc.addEventListener("close", () => {
      try { unsubSignal?.(); } catch {}
      pc.onicecandidate = null;
    });

    // --- Create offer + setLocal (map failures cleanly)
    const offer = await pc.createOffer();
    try {
      await pc.setLocalDescription(offer);
    } catch (err) {
      reject(new NoisyError({
        code: "NC_RTC_SDP_FAILED",
        message: "setLocalDescription(offer) failed",
        context: { phase: "offer" },
        cause: err,
      }));
      return;
    }
    // Use the *original* offer we created, or pc.localDescription equivalently
    signal.send({ type: "offer", sdp: { type: offer.type, sdp: offer.sdp } });

    // Also treat DC 'error' as a failure for the race
    dc.addEventListener("error", (err) => {
      try { clearTimeout(iceTimer); } catch {}
      reject(err);
    });
    } catch (err) {
      return reject(err);
    }
  });
}
