/**
 * Derive per-chunk IV by adding idx (uint32, big-endian) into the LOW 32 bits (bytes 8..11)
 * of a 96-bit base IV. High 64 bits (bytes 0..7) remain unchanged.
 * Invariant: "96-bit IV, BE counter in low 32 bits".
 */
export function deriveIv(baseIV: any, idx: any): Uint8Array<any>;
/**
 * Create an encryptor.
 * - alg: "AES-GCM"
 * - baseIV: 12-byte Uint8Array (exported so it can be included in KeyPacket)
 * - seal(id, idx, pt): returns ciphertext+tag (Uint8Array)
 */
export function makeEncryptor(keyBytes: any, baseIV?: Uint8Array<ArrayBuffer>): Promise<{
    alg: string;
    baseIV: Uint8Array<ArrayBuffer>;
    seal: (id: any, idx: any, pt: any) => Promise<Uint8Array<ArrayBuffer>>;
    encryptChunk: (id: any, idx: any, pt: any) => Promise<Uint8Array<ArrayBuffer>>;
}>;
/**
 * Create a decryptor compatible with makeEncryptor.
 * - open(id, idx, ct): returns plaintext (Uint8Array) or throws NoisyError
 */
export function makeDecryptor(keyBytes: any, baseIV: any): Promise<{
    open: (id: any, idx: any, ct: any) => Promise<Uint8Array<ArrayBuffer>>;
    decryptChunk: (id: any, idx: any, ct: any) => Promise<Uint8Array<ArrayBuffer>>;
}>;
