import { BINARY_FIELDS } from "@noisytransfer/constants"

const HAS_BUFFER = typeof Buffer !== "undefined" && typeof Buffer.from === "function";

function u8ToBase64(u8) {
  if (HAS_BUFFER) return Buffer.from(u8).toString("base64");
  // browser/Deno fallback
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i+CHUNK, u8.length)));
  }
  return btoa(bin);
}

function base64ToU8(b64) {
  if (HAS_BUFFER) return Uint8Array.from(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function binReplacer(key, value) {
  if (
    BINARY_FIELDS.has(key) &&
    (value instanceof Uint8Array || value instanceof ArrayBuffer)
  ) {
    const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
    return { __bin__: true, data: u8ToBase64(u8) };
  }
  return value;
}

export function binReviver(_key, value) {
  if (value && value.__bin__ && typeof value.data === "string") {
    return base64ToU8(value.data);
  }
  return value;
}
