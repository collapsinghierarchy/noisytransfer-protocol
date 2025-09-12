import { BINARY_FIELDS } from "@noisytransfer/constants";
import { b64, unb64 } from "@noisytransfer/util/base64";

const HAS_BUFFER = typeof Buffer !== "undefined" && typeof Buffer.from === "function";

export function binReplacer(key, value) {
  if (BINARY_FIELDS.has(key) && (value instanceof Uint8Array || value instanceof ArrayBuffer)) {
    const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
    return { __bin__: true, data: b64(u8) };
  }
  return value;
}

export function binReviver(_key, value) {
  if (value && value.__bin__ && typeof value.data === "string") {
    return unb64(value.data);
  }
  return value;
}
