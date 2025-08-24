import { shouldAcceptCandidate } from "./rtc-utils.js";
import { wrapDataChannel } from "./dc.js";
import { isTransport } from "../index.js";
import { NoisyError } from "../../errors/noisy-error.js";

export function rtcResponder(signal, rtcCfg = { iceServers: [] }) {
  if (!isTransport(signal)) {
    throw new NoisyError({ code: "NC_PROTOCOL", message: "rtcResponder: 'signal' must be a Transport" });
  }

   return new Promise(async (resolve, reject) => {
    const ICE_TIMEOUT_MS = Number((globalThis?.NOISY_RTC_ICE_TIMEOUT_MS ?? process?.env?.NOISY_RTC_ICE_TIMEOUT_MS) ?? 15000);
    const pc = new RTCPeerConnection(rtcCfg);
    
    const origRemote2 = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = async (desc) => {
      const r = await origRemote2(desc);
      return r;
    };
    const origLocal2 = pc.setLocalDescription.bind(pc);
    pc.setLocalDescription = async (desc) => {
      const r = await origLocal2(desc);
      return r;
    };

    const send = (m) => signal.send(m);

    const pending = [];
    let haveRemote = false;

    const unsubSignal = signal.onMessage(async (m) => {
      if (m?.type === "offer") {
        try { await pc.setRemoteDescription(m.sdp); }
        catch (err) { throw new NoisyError({ code: "NC_RTC_SDP_FAILED", message: "setRemoteDescription failed", context: { phase: "remote" }, cause: err }); }
        haveRemote = true;

        const answer = await pc.createAnswer();
        try {
          await pc.setLocalDescription(answer);
        } catch (err) {
          throw new NoisyError({
            code: "NC_RTC_SDP_FAILED",
            message: "setLocalDescription(answer) failed",
            context: { phase: "answer" },
            cause: err,
          });
        }
        const ans = pc.localDescription;
        send({ type: "answer", sdp: { type: ans.type, sdp: ans.sdp } });

        while (pending.length) await pc.addIceCandidate(pending.shift());
        return;
      }
      if (m?.type === "ice") {
        if (!m.cand) return; // ignore end-of-candidates
        if (!haveRemote) { pending.push(m.cand); return; }
        await pc.addIceCandidate(m.cand);
      }
    });

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return; // skip sentinel in Node/wrtc
      const candObj = ev.candidate.toJSON?.() ?? {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex
      };
      if (!shouldAcceptCandidate(candObj, { allowTcp: false, allowLoopbackV6: false })) return;
      send({ type: "ice", cand: candObj });
    };

    pc.addEventListener("datachannel", ev => {
    const dc = ev.channel;
    dc.binaryType = "arraybuffer";

    // --- DC open watchdog: reject if we never open once channel is created
    let iceTimer = setTimeout(() => {
      try { pc.onicecandidate = null; } catch {}
      try { unsubSignal?.(); } catch {}
      reject(new NoisyError({
        code: "NC_RTC_ICE_TIMEOUT",
        message: "ICE timed out before datachannel open",
        context: { timeoutMs: ICE_TIMEOUT_MS, role: "responder" },
        retriable: true,
      }));
    }, ICE_TIMEOUT_MS);

    dc.addEventListener("open", () => {
        try { unsubSignal?.(); } catch {}
        pc.onicecandidate = null; // stop trickling once we’re connected
        try { clearTimeout(iceTimer); } catch {}
        resolve(wrapDataChannel(dc, pc, "Responder"));
    });
    dc.addEventListener("error", err => {
        try { clearTimeout(iceTimer); } catch {}
        reject(err);
    });
    });
  });
}