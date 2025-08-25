import { randomFillSync, randomUUID as nodeRandomUUID } from 'node:crypto';

export function makeUUID() {
  // Prefer WebCrypto’s randomUUID if present (browsers / recent Node).
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Next, Node’s native randomUUID if available.
  if (typeof nodeRandomUUID === 'function') {
    return nodeRandomUUID();
  }
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20)
  );
}