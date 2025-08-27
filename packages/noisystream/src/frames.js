import { b64u, unb64u } from "@noisytransfer/util/base64";
import { asU8 } from "@noisytransfer/util/buffer";
import { NoisyError } from "@noisytransfer/errors/noisy-error";

/** @typedef {'ns_init'|'ns_ready'|'ns_data'|'ns_fin'} StreamFrameType */

export const STREAM = Object.freeze({
  INIT:  "ns_init",
  READY: "ns_ready",
  DATA:  "ns_data",
  FIN:   "ns_fin",
});

// ---------- Helpers ----------
const isStr = (x) => typeof x === "string" && x.length > 0;
const isBool = (x) => x === true || x === false;
const isNonNegInt = (x) => Number.isInteger(x) && x >= 0;

/** Throw NC_FRAME_INVALID with context */
function badFrame(message, context) {
  throw new NoisyError({ code: "NC_FRAME_INVALID", message, context });
}

// ---------- INIT ----------
/**
 * @param {{ sessionId: string, totalBytes: number, encTag?: Uint8Array|ArrayBuffer|null }} p
 * @returns {{ type:'ns_init', sessionId:string, totalBytes:number, encTag?:string }}
 */
export function packStreamInit({ sessionId, totalBytes, encTag = null }) {
  if (!isStr(sessionId)) badFrame("init.sessionId invalid", { field: "sessionId" });
  if (!isNonNegInt(totalBytes)) badFrame("init.totalBytes invalid", { field: "totalBytes" });
  const out = { type: STREAM.INIT, sessionId, totalBytes };
  if (encTag != null) out.encTag = b64u(asU8(encTag));
  return out;
}

/**
 * @param {any} m
 * @returns {{ sessionId:string, totalBytes:number, encTag?:Uint8Array }}
 */
export function parseStreamInit(m) {
  if (!m || m.type !== STREAM.INIT) badFrame("not ns_init", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("init.sessionId invalid", { field: "sessionId" });
  if (!isNonNegInt(m.totalBytes)) badFrame("init.totalBytes invalid", { field: "totalBytes" });
  const obj = { sessionId: m.sessionId, totalBytes: m.totalBytes };
  if (m.encTag != null) obj.encTag = unb64u(m.encTag);
  return obj;
}

// ---------- READY ----------
/**
 * @param {{ sessionId: string }} p
 * @returns {{ type:'ns_ready', sessionId:string }}
 */
export function packStreamReady({ sessionId }) {
  if (!isStr(sessionId)) badFrame("ready.sessionId invalid", { field: "sessionId" });
  return { type: STREAM.READY, sessionId };
}

/** @param {any} m */
export function parseStreamReady(m) {
  if (!m || m.type !== STREAM.READY) badFrame("not ns_ready", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("ready.sessionId invalid");
  return { sessionId: m.sessionId };
}

// ---------- DATA ----------
/**
 * @param {{ sessionId: string, seq: number, chunk: Uint8Array|ArrayBuffer }} p
 * @returns {{ type:'ns_data', sessionId:string, seq:number, chunk:string }}
 */
export function packStreamData({ sessionId, seq, chunk }) {
  if (!isStr(sessionId)) badFrame("data.sessionId invalid", { field: "sessionId" });
  if (!isNonNegInt(seq)) badFrame("data.seq invalid", { field: "seq" });
  const u8 = asU8(chunk);
  if (u8.byteLength === 0) badFrame("data.chunk empty", { field: "chunk" });
  return { type: STREAM.DATA, sessionId, seq, chunk: b64u(u8) };
}

/**
 * @param {any} m
 * @returns {{ sessionId:string, seq:number, chunk:Uint8Array }}
 */
export function parseStreamData(m) {
  if (!m || m.type !== STREAM.DATA) badFrame("not ns_data", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("data.sessionId invalid");
  if (!isNonNegInt(m.seq)) badFrame("data.seq invalid");
  const c = unb64u(m.chunk);
  if (!(c instanceof Uint8Array) || c.byteLength === 0) badFrame("data.chunk invalid");
  return { sessionId: m.sessionId, seq: m.seq, chunk: c };
}

// ---------- FIN ----------
/**
 * @param {{ sessionId: string, ok: boolean, errCode?: string }} p
 * @returns {{ type:'ns_fin', sessionId:string, ok:boolean, errCode?:string }}
 */
export function packStreamFin({ sessionId, ok, errCode }) {
  if (!isStr(sessionId)) badFrame("fin.sessionId invalid");
  if (!isBool(ok)) badFrame("fin.ok invalid");
  const out = { type: STREAM.FIN, sessionId, ok: !!ok };
  if (!ok && isStr(errCode)) out.errCode = errCode;
  return out;
}

/** @param {any} m */
export function parseStreamFin(m) {
  if (!m || m.type !== STREAM.FIN) badFrame("not ns_fin", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("fin.sessionId invalid");
  if (!isBool(m.ok)) badFrame("fin.ok invalid");
  const out = { sessionId: m.sessionId, ok: !!m.ok };
  if (m.errCode != null) {
    if (!isStr(m.errCode)) badFrame("fin.errCode invalid");
    out.errCode = m.errCode;
  }
  return out;
}

// ---------- Type guards (handy for switches) ----------
export const isStreamInit  = (m) => !!m && m.type === STREAM.INIT  && isStr(m.sessionId) && isNonNegInt(m.totalBytes);
export const isStreamReady = (m) => !!m && m.type === STREAM.READY && isStr(m.sessionId);
export const isStreamData  = (m) => !!m && m.type === STREAM.DATA  && isStr(m.sessionId) && isNonNegInt(m.seq) && typeof m.chunk === "string";
export const isStreamFin   = (m) => !!m && m.type === STREAM.FIN   && isStr(m.sessionId) && isBool(m.ok);
