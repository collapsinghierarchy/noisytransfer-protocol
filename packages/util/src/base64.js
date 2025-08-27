// packages/util/src/base64.js
import { NoisyError } from '@noisytransfer/errors/noisy-error';

// Base64 (standard) encoder for Uint8Array|ArrayBuffer
export function b64(data) {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (!(u8 instanceof Uint8Array)) {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'b64: expected Uint8Array|ArrayBuffer' });
  }
  // Node: Buffer is fastest and avoids btoa
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return Buffer.from(u8).toString('base64');
  }
  // Browser: use btoa on a binary string
  let str = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    str += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(str);
}

// Base64/URL-safe decoder. Accepts Uint8Array|ArrayBuffer and returns bytes unchanged.
export function unb64(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView?.(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input !== 'string') {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'unb64: expected base64 string or bytes' });
  }

  // Accept URL-safe, ignore whitespace, and fix padding
  let str = input.trim().replace(/[\r\n\t\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);

  try {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      return new Uint8Array(Buffer.from(str, 'base64'));
    }
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch (cause) {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'Invalid base64 input', cause });
  }
}

// URL-safe base64 (no padding)
export const b64url = (buf) => {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  const base = b64(u8);
  return base.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

// Back-compat names used around the codebase:
export const b64u = b64url;
export const unb64u = unb64;
