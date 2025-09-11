export function addEvt(target: any, type: any, cb: any): () => any;
export function shouldAcceptCandidate(cand: any, { allowTcp, allowLoopbackV6 }?: {
    allowTcp?: boolean;
    allowLoopbackV6?: boolean;
}): boolean;
/**
 * Parse all DTLS fingerprints from an SDP blob.
 * Returns [{ alg: "SHA-256", bytes: Uint8Array }, ...] in encounter order.
 */
export function parseDtlsFingerprintsFromSdp(sdp: any): {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
}[];
export function pickPreferredFingerprintFromSdp(sdp: any, preferred?: string[]): {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
};
export function getLocalFingerprintFromPC(pc: any): {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
};
export function getRemoteFingerprintFromPC(pc: any): {
    alg: string;
    bytes: Uint8Array<ArrayBuffer>;
};
export function hardCloseRTC(pc: any, { dc, timeout }?: {
    timeout?: number;
}): Promise<void>;
export function dialRtcUntilReady({ role, signal, rtcCfg, maxAttempts, backoffMs, }: {
    role: any;
    signal: any;
    rtcCfg?: {};
    maxAttempts?: number;
    backoffMs?: number;
}): Promise<{
    tx: any;
    attempt: number;
}>;
