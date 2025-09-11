export function packStreamInit({ sessionId, totalBytes, encTag, hpkeEnc }: {
    sessionId: any;
    totalBytes: any;
    encTag: any;
    hpkeEnc: any;
}): {
    type: "ns_init";
    sessionId: any;
};
export function parseStreamInit(m: any): {
    sessionId: any;
    totalBytes: any;
    encTag: Uint8Array<ArrayBufferLike>;
    hpkeEnc: any;
};
export function packStreamReady({ sessionId, totalBytes, features, windowChunks }: {
    sessionId: any;
    totalBytes?: any;
    features?: any;
    windowChunks?: any;
}): {
    type: "ns_ready";
    sessionId: any;
};
export function parseStreamReady(m: any): {
    sessionId: any;
};
export function packStreamData({ sessionId, seq, chunk, aead }: {
    sessionId: any;
    seq: any;
    chunk: any;
    aead?: any;
}): {
    type: "ns_data";
    sessionId: any;
    seq: any;
    chunk: string;
};
export function parseStreamData(m: any): {
    sessionId: any;
    seq: any;
    chunk: Uint8Array<ArrayBufferLike>;
};
/**
 * @param {{ sessionId: string, chunks:number }} p
* @returns {{ type:'ns_credit', sessionId:string, chunks:number }}
 */
export function packStreamCredit({ sessionId, chunks }: {
    sessionId: string;
    chunks: number;
}): {
    type: "ns_credit";
    sessionId: string;
    chunks: number;
};
/** @param {any} m */
export function parseStreamCredit(m: any): {
    sessionId: any;
    chunks: any;
};
/**
 * @param {{ sessionId: string, ok: boolean, errCode?: string }} p
 * @returns {{ type:'ns_fin', sessionId:string, ok:boolean, errCode?:string }}
 */
export function packStreamFin({ sessionId, ok, errCode }: {
    sessionId: string;
    ok: boolean;
    errCode?: string;
}): {
    type: "ns_fin";
    sessionId: string;
    ok: boolean;
    errCode?: string;
};
/** @param {any} m */
export function parseStreamFin(m: any): {
    sessionId: any;
    ok: boolean;
};
/**
 * @param {{ sessionId: string }} p
 * @returns {{ type:'ns_fin_ack', sessionId:string }}
 */
export function packStreamFinAck({ sessionId }: {
    sessionId: string;
}): {
    type: "ns_fin_ack";
    sessionId: string;
};
/** @param {any} m */
export function parseStreamFinAck(m: any): {
    sessionId: any;
};
export const STREAM: Readonly<{
    INIT: "ns_init";
    READY: "ns_ready";
    DATA: "ns_data";
    CREDIT: "ns_credit";
    FIN: "ns_fin";
    FIN_ACK: "ns_fin_ack";
}>;
export function isStreamInit(m: any): boolean;
export function isStreamReady(m: any): boolean;
export function isStreamData(m: any): boolean;
export function isStreamFin(m: any): boolean;
export function isStreamFinAck(m: any): boolean;
