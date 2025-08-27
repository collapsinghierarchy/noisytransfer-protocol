export function dialRtcUntilReady({ role, signal, rtcCfg, maxAttempts, backoffMs }: {
    role: any;
    signal: any;
    rtcCfg?: {};
    maxAttempts?: number;
    backoffMs?: number;
}): Promise<{
    tx: any;
    attempt: number;
}>;
export { rtcInitiator } from "./initiator.js";
export { rtcResponder } from "./responder.js";
export { hardCloseRTC } from "./rtc-utils.js";
