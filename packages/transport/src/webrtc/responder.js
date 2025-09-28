// packages/transport/src/webrtc/responder.js
import { NoisyError } from "@noisytransfer/errors/noisy-error";

import { isTransport } from "../core.js";
import {
  shouldAcceptCandidate,
  getLocalFingerprintFromPC,
  getRemoteFingerprintFromPC,
} from "./rtc-utils.js";
import { wrapDataChannel } from "./dc.js";

/**
 * Return a Transport facade immediately; connect later when an offer arrives.
 */
export function rtcResponder(signal, rtcCfg = {}, opts = {}) {
  if (!isTransport(signal)) {
    throw new NoisyError({
      code: "NC_PROTOCOL",
      message: "rtcResponder: 'signal' must be a Transport",
    });
  }
  const DBG = process?.env?.NT_DEBUG_RTC || process?.env?.NOISY_DEBUG_RTC;
  const dlog = (...a) => {
    if (DBG) console.log("[rtc:resp]", ...a);
  };
  const NON_TRICKLE = Boolean(
    opts?.nonTrickle ?? /^(1|true|yes)$/i.test(String(process?.env?.NOISY_RTC_NON_TRICKLE ?? ""))
  );

  let connected = false;
  const onUpHandlers = new Set();
  const onDownHandlers = new Set();
  const onCloseHandlers = new Set();
  const onMessageHandlers = new Set();

  let pc = null;
  let dc = null;
  let wrappedDc = null;
  let wrappedMsgUnsub = null;
  const wrappedCtlUnsubs = new Set();
  let hasClosed = false;
  let unsubSignal = null;
  let iceUnsub = null;

  // Buffer ICE/EoC arriving before we create the RTCPeerConnection (trickle only)
  const prePending = [];
  let preEoc = false;

  const sendGuard = (_) => {
    throw new NoisyError({ code: "NC_TRANSPORT_DOWN", message: "RTC DataChannel not open" });
  };

  const tx = {
    get isConnected() {
      return connected;
    },
    get isUp() {
      return connected;
    },
    onUp(cb) {
      onUpHandlers.add(cb);
      return () => onUpHandlers.delete(cb);
    },
    onDown(cb) {
      onDownHandlers.add(cb);
      return () => onDownHandlers.delete(cb);
    },
    onClose(cb) {
      onCloseHandlers.add(cb);
      return () => onCloseHandlers.delete(cb);
    },
    onMessage(cb) {
      onMessageHandlers.add(cb);
      return () => onMessageHandlers.delete(cb);
    },
    getLocalFingerprint() {
      return getLocalFingerprintFromPC(pc);
    },
    getRemoteFingerprint() {
      return getRemoteFingerprintFromPC(pc);
    },
    get bufferedAmount() {
      try {
        return wrappedDc?.bufferedAmount ?? 0;
      } catch {
        return 0;
      }
    },
    async flush() {
      try {
        await wrappedDc?.flush?.();
      } catch {}
    },
    features: undefined,
    send: sendGuard,
    async close(code = 1000, reason = "closed") {
      clearIceWatchdog();
      try {
        unsubSignal?.();
      } catch {}
      try {
        iceUnsub?.();
      } catch {}
      const currentWrapped = wrappedDc;
      cleanupWrappedDc();
      try {
        await currentWrapped?.close?.(code, reason);
      } catch {
        try {
          pc?.close?.();
        } catch {}
      }
      setConnected(false);
      safeFireClose({ code, reason });
    },
  };

   function cleanupWrappedDc() {
    try {
      wrappedMsgUnsub?.();
    } catch {}
    wrappedMsgUnsub = null;
    for (const un of [...wrappedCtlUnsubs]) {
      try {
        un?.();
      } catch {}
      wrappedCtlUnsubs.delete(un);
    }
    wrappedCtlUnsubs.clear();
    wrappedDc = null;
    dc = null;
    tx.send = sendGuard;
    tx.features = undefined;
  }

  function safeFireClose(ev) {
    if (hasClosed) return;
    hasClosed = true;
    fireClose(ev);
  }


  function fireUp() {
    for (const f of [...onUpHandlers])
      try {
        f();
      } catch {}
  }
  function fireDown() {
    for (const f of [...onDownHandlers])
      try {
        f();
      } catch {}
  }
  function fireClose(ev) {
    for (const f of [...onCloseHandlers])
      try {
        f(ev);
      } catch {}
  }
  function emitMessage(m) {
    for (const f of [...onMessageHandlers])
      try {
        f(m);
      } catch {}
  }
  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    v ? fireUp() : fireDown();
  }

  const ICE_TIMEOUT_MS = Number(
    globalThis?.NOISY_RTC_ICE_TIMEOUT_MS ?? process?.env?.NOISY_RTC_ICE_TIMEOUT_MS ?? 15000
  );
  let iceTimer = null;
  function armIceWatchdog() {
    clearTimeout(iceTimer);
    if (ICE_TIMEOUT_MS > 0) {
      iceTimer = setTimeout(() => {
        try {
          pc?.close?.();
        } catch {}
        setConnected(false);
        safeFireClose({ code: 1011, reason: "NC_RTC_ICE_TIMEOUT" });
      }, ICE_TIMEOUT_MS);
    }
  }
  function clearIceWatchdog() {
    clearTimeout(iceTimer);
    iceTimer = null;
  }

  const waitGatherComplete = async () => {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((res, rej) => {
      let timer = null;
      const onchg = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", onchg);
          res();
        }
      };
      pc.addEventListener("icegatheringstatechange", onchg);
      timer = setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", onchg);
        rej(
          new NoisyError({
            code: "NC_RTC_ICE_TIMEOUT",
            message: "gathering did not complete",
            context: { role: "responder" },
          })
        );
      }, ICE_TIMEOUT_MS);
    });
  };

  async function handleOffer(offerMsg) {
    try {
      if (!pc) {
        pc = new RTCPeerConnection(rtcCfg);
        dlog("created pc");

        // Outgoing ICE (trickle only)
        let eocSent = false;
        if (!NON_TRICKLE) {
          pc.onicecandidate = (ev) => {
            const c = ev?.candidate;
            if (!c) {
              if (!eocSent) {
                eocSent = true;
                try {
                  signal.send({ type: "ice", cand: null });
                } catch {}
              }
              return;
            }
            const candObj = c.toJSON?.() ?? {
              candidate: c.candidate,
              sdpMid: c.sdpMid,
              sdpMLineIndex: c.sdpMLineIndex,
            };
            const isNode = typeof window === "undefined";
            if (!isNode) {
              if (
                typeof shouldAcceptCandidate === "function" &&
                !shouldAcceptCandidate(candObj, { allowTcp: true, allowLoopbackV6: true })
              ) {
                return;
              }
            }
            signal.send({ type: "ice", cand: candObj });
          };
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete" && !eocSent) {
              try {
                signal.send({ type: "ice", cand: null });
              } catch {}
              eocSent = true;
            }
          });
        }

        // Incoming ICE (trickle only): defer until remote SDP; apply EoC once
        let eocApplied = false;
        let haveRemote = false;
        let eocPending = false;
        const pending = [];
        iceUnsub = signal.onMessage(async (m) => {
          if (!m || m.type !== "ice") return;
          if (NON_TRICKLE) return; // ignore trickle when non-trickle is active
          const cand = m.cand ?? m.candidate;
          if (cand === null) {
            if (!eocApplied) {
              if (haveRemote) {
                eocApplied = true;
                try {
                  await pc.addIceCandidate(null);
                } catch {}
              } else {
                eocPending = true;
              }
            }
            return;
          }
          if (!cand) return;
          if (!haveRemote) pending.push(cand);
          else
            try {
              await pc.addIceCandidate(cand);
            } catch {}
        });

        // DC from initiator
        pc.ondatachannel = (ev) => {
          cleanupWrappedDc();
          hasClosed = false;
          dc = ev.channel;
          wrappedDc = wrapDataChannel(dc, pc, "Responder");
          tx.features = wrappedDc.features;

          wrappedMsgUnsub = wrappedDc.onMessage((payload) => {
            emitMessage(payload);
          });

          const unUp = wrappedDc.onUp(() => {
            clearIceWatchdog();
            tx.send = (...args) => wrappedDc.send(...args);
            setConnected(true);
            if (!NON_TRICKLE) {
              try {
                pc.onicecandidate = null;
              } catch {}
            }
          });
          const unDown = wrappedDc.onDown(() => {
            setConnected(false);
            tx.send = sendGuard;
          });
          const unClose = wrappedDc.onClose(() => {
            setConnected(false);
            tx.send = sendGuard;
            cleanupWrappedDc();
            safeFireClose({ code: 1000, reason: "dc closed" });
          });
          wrappedCtlUnsubs.add(unUp);
          wrappedCtlUnsubs.add(unDown);
          wrappedCtlUnsubs.add(unClose);
        };

        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") {
            setConnected(false);
            tx.send = sendGuard;
            cleanupWrappedDc();
            safeFireClose({ code: 1011, reason: "RTC failed" });
          }
        });
      }

      const offer = offerMsg.offer ?? offerMsg.sdp;
      await pc.setRemoteDescription(
        offer && typeof offer.toJSON === "function" ? offer : new RTCSessionDescription(offer)
      );

      // Drain any pre-PC ICE/EoC (trickle only)
      if (!NON_TRICKLE) {
        for (const c of prePending.splice(0)) {
          try {
            await pc.addIceCandidate(c);
          } catch {}
        }
        if (preEoc) {
          try {
            await pc.addIceCandidate(null);
          } catch {}
          preEoc = false;
        }
      }

      // Create/Set local answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (NON_TRICKLE) {
        await waitGatherComplete();
        signal.send({ type: "answer", sdp: pc.localDescription });
      } else {
        signal.send({ type: "answer", sdp: pc.localDescription });
      }

      armIceWatchdog();
    } catch (e) {
      try {
        pc?.close?.();
      } catch {}
      setConnected(false);
      safeFireClose({ code: 1011, reason: String(e?.message || e) });
    }
  }

  // Stay subscribed; buffer pre-PC ICE/EoC in trickle mode
  let seenOffer = false;
  unsubSignal = signal.onMessage((m) => {
    if (!m || typeof m !== "object") return;
    if (!seenOffer && m.type === "offer" && (m.offer || m.sdp)) {
      seenOffer = true;
      handleOffer(m);
      return;
    }
    if (!pc && !NON_TRICKLE && m.type === "ice") {
      const cand = m.cand ?? m.candidate;
      if (cand === null) {
        preEoc = true;
        return;
      }
      if (!cand) return;
      prePending.push(cand);
    }
  });

  tx.onClose(() => {
    clearIceWatchdog();
    try {
      unsubSignal?.();
    } catch {}
    try {
      iceUnsub?.();
    } catch {}
    try {
      pc?.close?.();
    } catch {}
  });

  return tx;
}
