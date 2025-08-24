// Shared constants and helpers for the noisycache courier.
export const FRAME_TYPE = 'nc_courier_v1';

/**
 * makeCourierFrame
 * @param {{ sessionId: string, enc: Uint8Array|ArrayBuffer, ct: Uint8Array|ArrayBuffer, sig: Uint8Array|ArrayBuffer }} p
 * @returns {{ type: string, sessionId: string, enc: string, ct: string, sig: string, sigAlg: string }}
 */
import { b64u } from '../util/base64.js';
export function makeCourierFrame({ sessionId, enc, ct, sig }) {
  return {
    type: FRAME_TYPE,
    sessionId,
    enc: b64u(enc),
    ct:  b64u(ct),
    sig: b64u(sig),
    sigAlg: 'RSA-PSS-SHA256',
  };
}

/** Guard for courier frame */
export const isCourierFrame = (o) =>
  o && o.type === FRAME_TYPE && typeof o.sessionId === 'string'
  && typeof o.enc === 'string' && typeof o.ct === 'string'
  && typeof o.sig === 'string' && o.sigAlg === 'RSA-PSS-SHA256';
