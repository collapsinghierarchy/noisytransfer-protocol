// AUTH
export const AUTH = {
  PROTO_LABEL: "noisy/auth/v1",
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

// Convenience re-export (legacy)
export const PROTO_LABEL = AUTH.PROTO_LABEL;

// ---- Migrated from @noisytransfer/constants on 2025-08-27 ----
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
