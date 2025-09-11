import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { b64u, unb64u, asU8, logger } from "@noisytransfer/util";

export const STREAM = Object.freeze({
  INIT: "ns_init",
  READY: "ns_ready",
  DATA: "ns_data",
  CREDIT: "ns_credit",
  FIN: "ns_fin",
  FIN_ACK: "ns_fin_ack",
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
export function packStreamInit({ sessionId, totalBytes, encTag, hpkeEnc }) {
  if (!isStr(sessionId)) badFrame("init.sessionId invalid", { field: "sessionId" });
  const msg = { type: STREAM.INIT, sessionId };
  if (isNonNegInt(totalBytes)) msg.totalBytes = totalBytes;
  if (encTag instanceof Uint8Array) msg.encTag = b64u(encTag);
  // JSON-safe: send encapsulated KEM key as base64url
   if (hpkeEnc !== null) msg.hpkeEnc = b64u(asU8(hpkeEnc));
  else badFrame("hpkeEnc invalid or missing");
  return msg;
}

export function parseStreamInit(m) {
  if (!m || m.type !== STREAM.INIT) badFrame("not ns_init", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("init.sessionId invalid", { field: "sessionId" });
  const totalBytes = isNonNegInt(m.totalBytes) ? m.totalBytes : undefined;
  // Accept base64 string (preferred) or already-Uint8Array (in case of in-process transport)
  let hpkeEnc = m.hpkeEnc;
  if (typeof hpkeEnc === "string") hpkeEnc = unb64u(hpkeEnc);
  if (!(hpkeEnc instanceof Uint8Array)) badFrame("init.hpkeEnc invalid");
  let encTag;
  if (typeof m.encTag === "string") encTag = unb64u(m.encTag);
  return { sessionId: m.sessionId, totalBytes, encTag, hpkeEnc };
}

// ---------- READY ----------
export function packStreamReady({ sessionId, totalBytes = undefined, features = undefined, windowChunks = undefined }) {
  if (!isStr(sessionId)) badFrame("ready.sessionId invalid", { field: "sessionId" });
  const out = { type: STREAM.READY, sessionId };
  if (isNonNegInt(totalBytes)) out.totalBytes = totalBytes;
  if (features != null) out.features = features;
  if (isNonNegInt(windowChunks)) out.windowChunks = windowChunks;
  return out;
}

export function parseStreamReady(m) {
  if (!m || m.type !== STREAM.READY) badFrame("not ns_ready", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("ready.sessionId invalid");
  const obj = { sessionId: m.sessionId };
  if (isNonNegInt(m.totalBytes)) obj.totalBytes = m.totalBytes;
  if (m.features != null) obj.features = m.features;
  if (isNonNegInt(m.windowChunks)) obj.windowChunks = m.windowChunks;
  return obj;
}

// ---------- DATA ----------
export function packStreamData({ sessionId, seq, chunk, aead = undefined }) {
  if (!isStr(sessionId)) badFrame("data.sessionId invalid", { field: "sessionId" });
  if (!isNonNegInt(seq)) badFrame("data.seq invalid", { field: "seq" });
  const u8 = asU8(chunk);
  if (u8.byteLength === 0) badFrame("data.chunk empty", { field: "chunk" });
  const out = { type: STREAM.DATA, sessionId, seq, chunk: b64u(u8) };
  if (aead != null) out.aead = aead;
  return out;
}

export function parseStreamData(m) {
  if (!m || m.type !== STREAM.DATA) badFrame("not ns_data", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("data.sessionId invalid");
  if (!isNonNegInt(m.seq)) badFrame("data.seq invalid");
  const c = unb64u(m.chunk);
  if (!(c instanceof Uint8Array) || c.byteLength === 0) badFrame("data.chunk invalid");
  const obj = { sessionId: m.sessionId, seq: m.seq, chunk: c };
  if (m.aead != null) obj.aead = m.aead;
  return obj;
}

// ---------- CREDIT ----------
/**
 * @param {{ sessionId: string, chunks:number }} p
* @returns {{ type:'ns_credit', sessionId:string, chunks:number }}
 */
export function packStreamCredit({ sessionId, chunks }) {
  if (!isStr(sessionId)) badFrame("credit.sessionId invalid");
  if (!isNonNegInt(chunks)) badFrame("credit.chunks invalid");
  return { type: STREAM.CREDIT, sessionId, chunks };
}

/** @param {any} m */
export function parseStreamCredit(m) {
  if (!m || m.type !== STREAM.CREDIT) badFrame("not ns_credit", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("credit.sessionId invalid");
  if (!isNonNegInt(m.chunks)) badFrame("credit.chunks invalid");
   return { sessionId: m.sessionId, chunks: m.chunks };
}

// ---------- FIN ----------
/**
 * Pack ns_fin frame.
 * @param {{
 *   sessionId: string,
 *   ok: boolean,
 *   errCode?: string,
 *   sig?: Uint8Array,
 *   sigAlg?: string,
 *   sigPub?: Uint8Array
 * }} p
 * @returns {{ type:'ns_fin', sessionId:string, ok:boolean, errCode?:string, sig?:string, sigAlg?:string, sigPub?:string }}
 */
export function packStreamFin({ sessionId, ok, errCode, sig, sigAlg, sigPub }) {
  if (!isStr(sessionId)) badFrame("fin.sessionId invalid");
  if (!isBool(ok)) badFrame("fin.ok invalid");

  const out = { type: STREAM.FIN, sessionId, ok: !!ok };

  if (!ok && isStr(errCode)) out.errCode = errCode;

  // Optional signature fields (encode to base64url for transport)
  if (sig instanceof Uint8Array && sig.byteLength > 0) out.sig = b64u(sig);
  if (typeof sigAlg === "string" && sigAlg.length > 0) out.sigAlg = sigAlg;
  if (sigPub instanceof Uint8Array && sigPub.byteLength > 0) out.sigPub = b64u(sigPub);

  return out;
}

/**
 * Parse ns_fin frame (lenient on optional signature fields; algorithm validated later).
 * @param {any} m
 * @returns {{ sessionId:string, ok:boolean, errCode?:string, sig?:Uint8Array, sigAlg?:string, sigPub?:Uint8Array }}
 */
export function parseStreamFin(m) {
  if (!m || m.type !== STREAM.FIN) badFrame("not ns_fin", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("fin.sessionId invalid");
  if (!isBool(m.ok)) badFrame("fin.ok invalid");

  // Optional diagnostics
  try { logger?.debug?.("[ns] parseStreamFin", { m }); } catch {}

  // Optional fields
  let sig, sigPub, sigAlg;

  // Accept base64url strings or raw Uint8Array (in-process transports)
  if (typeof m.sig === "string") sig = unb64u(m.sig);
  else if (m.sig instanceof Uint8Array) sig = m.sig;
  else if (m.sig != null) badFrame("fin.sig invalid");

  if (typeof m.sigPub === "string") sigPub = unb64u(m.sigPub);
  else if (m.sigPub instanceof Uint8Array) sigPub = m.sigPub;
  else if (m.sigPub != null) badFrame("fin.sigPub invalid");

  if (typeof m.sigAlg === "string") sigAlg = m.sigAlg;
  else if (m.sigAlg != null) badFrame("fin.sigAlg invalid");

  const out = {
    sessionId: m.sessionId,
    ok: !!m.ok,
    errCode: (m.errCode != null ? (isStr(m.errCode) ? m.errCode : badFrame("fin.errCode invalid")) : undefined),
    sig,
    sigAlg,
    sigPub,
  };

  return out;
}

// ---------- FIN_ACK ----------
/**
 * @param {{ sessionId: string }} p
 * @returns {{ type:'ns_fin_ack', sessionId:string }}
 */
export function packStreamFinAck({ sessionId }) {
  if (!isStr(sessionId)) badFrame("fin_ack.sessionId invalid");
  return { type: STREAM.FIN_ACK, sessionId };
}

/** @param {any} m */
export function parseStreamFinAck(m) {
  if (!m || m.type !== STREAM.FIN_ACK) badFrame("not ns_fin_ack", { got: m?.type });
  if (!isStr(m.sessionId)) badFrame("fin_ack.sessionId invalid");
  return { sessionId: m.sessionId };
}

// ---------- Type guards (handy for switches) ----------
export const isStreamInit = (m) =>
  !!m && m.type === STREAM.INIT && isStr(m.sessionId) && isNonNegInt(m.totalBytes);
export const isStreamReady = (m) => !!m && m.type === STREAM.READY && isStr(m.sessionId);
export const isStreamData = (m) =>
  !!m &&
  m.type === STREAM.DATA &&
  isStr(m.sessionId) &&
  isNonNegInt(m.seq) &&
  typeof m.chunk === "string";
export const isStreamFin = (m) =>
  !!m && m.type === STREAM.FIN && isStr(m.sessionId) && isBool(m.ok);
export const isStreamFinAck = (m) => !!m && m.type === STREAM.FIN_ACK && isStr(m.sessionId);
