export const PROTO_LABEL = "noisy/auth/v1";

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