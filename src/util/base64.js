
import { NoisyError } from '../errors/noisy-error.js';

// Base64 (standard) encoder for Uint8Array|ArrayBuffer
export function b64(data) {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let str = "";
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
  if (typeof input !== "string") {
   throw new NoisyError({ code: "NC_BAD_PARAM", message: "unb64: expected string|Uint8Array|ArrayBuffer" });
  }
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

// URL-safe base64 (no padding)
export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Back-compat names used around the codebase:
export const b64u = b64url;
export const unb64u = unb64;