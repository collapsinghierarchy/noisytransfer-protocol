export function createSHA256(): any;
/** SHA-256 via WebCrypto; returns Uint8Array */
export function sha256(data: any): Promise<Uint8Array<any>>;
/** Constant-time equality for byte-like inputs */
export function constantTimeEqual(a: any, b: any): boolean;
/** Hex helpers (tiny and dependency-free) */
export function toHex(u8: any): string;
export function fromHex(hex: any): Uint8Array<ArrayBuffer>;
/** SHA3-256; falls back to SHA-256 if @noble/hashes is missing */
export function sha3_256(data: any): Promise<any>;
/** SHAKE128 XOF; falls back to SHA-256-based expander (deterministic PRF) */
export function shake128(input: any, dkLen: any): Promise<any>;
export { Readable };
