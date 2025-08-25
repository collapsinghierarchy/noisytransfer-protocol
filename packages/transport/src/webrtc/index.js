export { rtcInitiator } from "./initiator.js";
export { rtcResponder } from "./responder.js";

import { NoisyError } from "@noisytransfer/errors/noisy-error.js";

export async function dialRtcUntilReady({ role, signal, rtcCfg = {}, maxAttempts = 3, backoffMs = 200 }) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw;
    try {
      raw = role === "initiator" ? await rtcInitiator(signal, rtcCfg)
                                 : await rtcResponder(signal, rtcCfg);
      return { tx: raw, attempt };
    } catch (err) {
      lastErr = err;
      if (err?.code === "TRANSPORT_LOST_PRE_READY") {
        try { raw?.close?.(); } catch {}
        await new Promise(r => setTimeout(r, backoffMs * attempt));
        continue;
      }
      try { raw?.close?.(); } catch {}
      throw err;
    }
  }
  throw lastErr ?? new NoisyError({ code: "NC_PROTOCOL", message: "RTC: exhausted attempts" });
}