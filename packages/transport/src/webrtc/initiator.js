import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { logger } from "@noisytransfer/util/logger";

import { wrapDataChannel } from "./dc.js";
import { shouldAcceptCandidate } from "./rtc-utils.js";
import { isTransport } from "../core.js";

export function rtcInitiator(signal, rtcCfg = { iceServers: [] }, opts = {}) {
  if (!isTransport(signal)) {
    throw new NoisyError({
      code: "NC_PROTOCOL",
      message: "rtcInitiator: 'signal' must be a Transport",
    });
  }

  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const ICE_TIMEOUT_MS = Number(
          globalThis?.NOISY_RTC_ICE_TIMEOUT_MS ?? process?.env?.NOISY_RTC_ICE_TIMEOUT_MS ?? 15000
        );
        const NON_TRICKLE = Boolean(
          opts?.nonTrickle ??
            /^(1|true|yes)$/i.test(String(process?.env?.NOISY_RTC_NON_TRICKLE ?? ""))
        );

        const pc = new RTCPeerConnection(rtcCfg);
        let unsubSignal = null;

        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") {
            try {
              unsubSignal?.();
            } catch {}
            pc.onicecandidate = null;
            reject(
              new NoisyError({ code: "NC_RTC_ICE_FAILED", message: "RTCPeerConnection failed" })
            );
          } else if (pc.connectionState === "closed") {
            try {
              unsubSignal?.();
            } catch {}
            pc.onicecandidate = null;
          }
        });

        const __DEBUG_RTC =
          (typeof process !== "undefined" && process.env && process.env.NOISY_DEBUG_RTC) ||
          (typeof globalThis !== "undefined" && globalThis.NOISY_DEBUG_RTC);
        if (__DEBUG_RTC) {
          const origSetRemote = pc.setRemoteDescription.bind(pc);
          pc.setRemoteDescription = async (desc) => {
            const r = await origSetRemote(desc);
            logger.debug("🔄 setRemoteDescription");
            return r;
          };
          const origSetLocal = pc.setLocalDescription.bind(pc);
          pc.setLocalDescription = async (desc) => {
            const r = await origSetLocal(desc);
            logger.debug("🔄 setLocalDescription");
            return r;
          };
        }

        const pending = [];
        let haveRemote = false;
        let eocSent = false;
        let eocApplied = false;
        let eocPending = false;

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
                  context: { timeoutMs: ICE_TIMEOUT_MS, role: "initiator" },
                })
              );
            }, ICE_TIMEOUT_MS);
          });
        };

        // Incoming signalling (answer + optional trickled ICE)
        unsubSignal = signal.onMessage(async (m) => {
          if (m?.type === "answer") {
            try {
              const ans = m.sdp;
              await pc.setRemoteDescription(
                ans && typeof ans.toJSON === "function" ? ans : new RTCSessionDescription(ans)
              );
            } catch (err) {
              reject(
                new NoisyError({
                  code: "NC_RTC_SDP_FAILED",
                  message: "setRemoteDescription(answer) failed",
                  context: { phase: "remote" },
                  cause: err,
                })
              );
              return;
            }
            haveRemote = true;
            while (pending.length) {
              try {
                await pc.addIceCandidate(pending.shift());
              } catch {}
            }
            if (eocPending && !eocApplied) {
              eocApplied = true;
              try {
                await pc.addIceCandidate(null);
              } catch {}
            }
          } else if (!NON_TRICKLE && m?.type === "ice") {
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
          }
        });

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
              if (!shouldAcceptCandidate(candObj, { allowTcp: true, allowLoopbackV6: true }))
                return;
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

        // Create DC before offer
        const dc = pc.createDataChannel("data", { ordered: true });

        // Open watchdog
        let iceTimer = setTimeout(() => {
          try {
            pc.onicecandidate = null;
          } catch {}
          try {
            unsubSignal?.();
          } catch {}
          reject(
            new NoisyError({
              code: "NC_RTC_ICE_TIMEOUT",
              message: "ICE timed out before datachannel open",
              context: { timeoutMs: ICE_TIMEOUT_MS, role: "initiator" },
              retriable: true,
            })
          );
        }, ICE_TIMEOUT_MS);

        dc.addEventListener("open", () => {
          if (!NON_TRICKLE) {
            if (!eocSent) {
              try {
                signal.send({ type: "ice", cand: null });
              } catch {}
              eocSent = true;
            }
            try {
              pc.onicecandidate = null;
            } catch {}
          }
          try {
            unsubSignal?.();
          } catch {}
          try {
            clearTimeout(iceTimer);
          } catch {}
          resolve(wrapDataChannel(dc, pc, "Initiator"));
        });

        dc.addEventListener("error", (err) => {
          try {
            clearTimeout(iceTimer);
          } catch {}
          reject(err);
        });

        dc.addEventListener("close", () => {
          try {
            clearTimeout(iceTimer);
          } catch {}
          try {
            unsubSignal?.();
          } catch {}
          try {
            pc.onicecandidate = null;
          } catch {}
        });

        // Create & set local offer
        const offer = await pc.createOffer();
        try {
          await pc.setLocalDescription(offer);
        } catch (err) {
          reject(
            new NoisyError({
              code: "NC_RTC_SDP_FAILED",
              message: "setLocalDescription(offer) failed",
              context: { phase: "offer" },
              cause: err,
            })
          );
          return;
        }

        // Send SDP at the right time for each mode (exactly once)
        if (NON_TRICKLE) {
          await waitGatherComplete();
          signal.send({ type: "offer", sdp: pc.localDescription });
        } else {
          signal.send({ type: "offer", sdp: pc.localDescription });
        }
      } catch (err) {
        reject(err);
      }
    })();
  });
}
