/**
 * Generate an ephemeral RSA-PSS key pair for signing/verifying.
 * @returns {Promise<{verificationKey: Uint8Array, signingKey: CryptoKey}>}
 */
export function genRSAPSS(): Promise<{
  verificationKey: Uint8Array;
  signingKey: CryptoKey;
}>;
/**
 * Sign data with RSA-PSS (saltLength equal to hash length).
 * @param {CryptoKey} signingKey
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
export function signChunk(
  signingKey: CryptoKey,
  data: ArrayBuffer | Uint8Array
): Promise<Uint8Array>;
export function importVerifyKey(spkiBytesU8: any): Promise<CryptoKey>;
/**
 * Verify a signature.
 * @param {CryptoKey} verifyKey
 * @param {ArrayBuffer|Uint8Array} signature
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<boolean>}
 */
export function verifyChunk(
  verifyKey: CryptoKey,
  signature: ArrayBuffer | Uint8Array,
  data: ArrayBuffer | Uint8Array
): Promise<boolean>;
export function createRSAVerifier(): import("crypto").Verify;
