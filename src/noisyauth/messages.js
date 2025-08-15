import { FRAME, ID_KIND } from "./constants.js";
import { b64url } from "../util/base64.js"; // uses your helpers: b64, unb64, b64url
import { NoisyError } from '../errors/noisy-error.js';

export function isFrame(m, type, sessionId) {
  if (!m || typeof m !== "object") return false;
  if (m.type !== type) return false;
  if (sessionId && m.sessionId !== sessionId) return false;
  return true;
}

/** commit: carries only commitment digest (no key material) */
export function makeCommit({ session, commitment, algs, recvMeta }) {
  return {
    type: FRAME.COMMIT,
    sessionId: session.sessionId,
    commit: {
      roomId: session.roomId,
      algs,
      commitment: b64url(commitment),
      recv: recvMeta && { id: recvMeta.id, vk: recvMeta.vk },
    },
  };
}

/** offer: sender -> receiver (msg_S || nonce_S) */
export function makeOffer({ session, msgS, nonceS }) {
  return {
    type: FRAME.OFFER,
    sessionId: session.sessionId,
    offer: {
      msgS:   b64url(msgS),
      nonceS: b64url(nonceS),
    },
  };
}

/** reveal: receiver -> sender (msg_R || nonce_R) */
export function makeReveal({ session, msgR, nonceR }) {
  return {
    type: FRAME.REVEAL,
    sessionId: session.sessionId,
    reveal: {
      msgR:   b64url(msgR),
      nonceR: b64url(nonceR),
    },
  };
}

/** optional ack */
export function makeRcvConfirm({ session }) {
  return { type: FRAME.RCVCONFIRM, sessionId: session.sessionId };
}

// --- helpers you already use elsewhere (unchanged) ---
export function normalizeId(id) {
  if (!id) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'authcore/messages: identity missing' });
  const kind = id.kind || ID_KIND.PUBKEY;
  const data = kind === ID_KIND.CERT ? toString(id.data) : toBytes(id.data);
  return { kind, data };
}

export function toBytes(x) {
  if (x == null) return new Uint8Array();
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof x === "string") return new TextEncoder().encode(x);
  throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'authcore/messages: toBytes unsupported type' });
}

export function toString(x) {
  if (typeof x === "string") return x;
  if (x instanceof Uint8Array) return new TextDecoder().decode(x);
  if (ArrayBuffer.isView(x)) return new TextDecoder().decode(toBytes(x));
  if (x instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(x));
  throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'authcore/messages: toString unsupported type' });
}