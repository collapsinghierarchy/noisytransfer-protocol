/**
 * @param {{ sessionId: string, totalBytes: number, encTag?: Uint8Array|ArrayBuffer|null }} p
 * @returns {{ type:'ns_init', sessionId:string, totalBytes:number, encTag?:string }}
 */
export function packStreamInit({
  sessionId,
  totalBytes,
  encTag,
}: {
  sessionId: string;
  totalBytes: number;
  encTag?: Uint8Array | ArrayBuffer | null;
}): {
  type: "ns_init";
  sessionId: string;
  totalBytes: number;
  encTag?: string;
};
/**
 * @param {any} m
 * @returns {{ sessionId:string, totalBytes:number, encTag?:Uint8Array }}
 */
export function parseStreamInit(m: any): {
  sessionId: string;
  totalBytes: number;
  encTag?: Uint8Array;
};
/**
 * @param {{ sessionId: string }} p
 * @returns {{ type:'ns_ready', sessionId:string }}
 */
export function packStreamReady({ sessionId }: { sessionId: string }): {
  type: "ns_ready";
  sessionId: string;
};
/** @param {any} m */
export function parseStreamReady(m: any): {
  sessionId: any;
};
/**
 * @param {{ sessionId: string, seq: number, chunk: Uint8Array|ArrayBuffer }} p
 * @returns {{ type:'ns_data', sessionId:string, seq:number, chunk:string }}
 */
export function packStreamData({
  sessionId,
  seq,
  chunk,
}: {
  sessionId: string;
  seq: number;
  chunk: Uint8Array | ArrayBuffer;
}): {
  type: "ns_data";
  sessionId: string;
  seq: number;
  chunk: string;
};
/**
 * @param {any} m
 * @returns {{ sessionId:string, seq:number, chunk:Uint8Array }}
 */
export function parseStreamData(m: any): {
  sessionId: string;
  seq: number;
  chunk: Uint8Array;
};
/**
 * @param {{ sessionId: string, ok: boolean, errCode?: string }} p
 * @returns {{ type:'ns_fin', sessionId:string, ok:boolean, errCode?:string }}
 */
export function packStreamFin({
  sessionId,
  ok,
  errCode,
}: {
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
export function packStreamFinAck({ sessionId }: { sessionId: string }): {
  type: "ns_fin_ack";
  sessionId: string;
};
/** @param {any} m */
export function parseStreamFinAck(m: any): {
  sessionId: any;
};
/** @typedef {'ns_init'|'ns_ready'|'ns_data'|'ns_fin'|'ns_fin_ack'} StreamFrameType */
export const STREAM: Readonly<{
  INIT: "ns_init";
  READY: "ns_ready";
  DATA: "ns_data";
  FIN: "ns_fin";
  FIN_ACK: "ns_fin_ack";
}>;
export function isStreamInit(m: any): boolean;
export function isStreamReady(m: any): boolean;
export function isStreamData(m: any): boolean;
export function isStreamFin(m: any): boolean;
export function isStreamFinAck(m: any): boolean;
export type StreamFrameType = "ns_init" | "ns_ready" | "ns_data" | "ns_fin" | "ns_fin_ack";
