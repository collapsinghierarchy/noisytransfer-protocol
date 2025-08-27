// AUTH
export const AUTH = {
  PROTO_LABEL: "noisy/auth/v1",
};

export const ALG = {
  KDF: "HKDF-SHA-256",
  SAS: "DECIMAL6",      // 6 digits
};

export const FRAME = {
  COMMIT: "commit",
  OFFER: "offer",
  REVEAL: "reveal",
  RCVCONFIRM: "rcvconfirm",
};

export const ID_KIND = {
  CERT: "cert",
  PUBKEY: "pubkey",
};

// STREAM
export const STREAM = {
  LABEL_S2R: "noisy/stream/s2r/v1",
  LABEL_R2S: "noisy/stream/r2s/v1",
};

// CRYPTO
export const CRYPTO = {
  // Domain-separation prefix for commitments
  COMMIT_DS_PREFIX: "NOISY-COMMIT\u0000v1",
};

// CACHE
export const CACHE = {
  FRAME_TYPE: "nc_courier_v1",
  KEYPACKET_TYPE: "nc_keypacket_v1",
  SIG_ALG: "RSA-PSS-SHA256",
};

export const BINARY_FIELDS = new Set([
  "nonceA","nonceB","vk","pkB","enc","ct","sig","commitment"
]);

// Small helper: read numeric override from process.env or globalThis, else fallback
function envNum(name, fallback) {
  // prefer explicit global override if set (useful in browser tests)
  const g = (typeof globalThis !== "undefined" ? globalThis[name] : undefined);
  const p = (typeof process !== "undefined" && process?.env ? process.env[name] : undefined);
  const raw = g ?? p;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const TIMEOUTS = {
  ws_async: { WAIT_COMMIT: 0, WAIT_OFFER: 0, WAIT_REVEAL: 0, SAS_CONFIRM: 30 * 60_000 },
  rtc: {
    WAIT_COMMIT: envNum('NOISYAUTH_WAIT_COMMIT_MS', 8_000),
    WAIT_OFFER:  envNum('NOISYAUTH_WAIT_OFFER_MS',  8_000),
    WAIT_REVEAL: envNum('NOISYAUTH_WAIT_REVEAL_MS', 8_000),
    SAS_CONFIRM: envNum('NOISYAUTH_WAIT_CONFIRM_MS',12_000),
  },
};

// Convenience re-export (legacy)
export const PROTO_LABEL = AUTH.PROTO_LABEL;
