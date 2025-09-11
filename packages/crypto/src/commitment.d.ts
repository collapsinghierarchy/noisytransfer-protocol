/** Generate cryptographically strong random nonce (default 32 bytes). */
export function randomNonce(nonceBytes?: number): Uint8Array<ArrayBuffer>;
/**
 * Compute commitment C = H( DS || LP(label) || LP(data) || LP(nonce) )
 * @param {ArrayBufferView|ArrayBuffer} data
 * @param {{ nonce?: ArrayBufferView|ArrayBuffer, nonceBytes?: number, hash?: 'SHA3-256'|'SHA-256', label?: string }} [opts]
 * @returns {Promise<{ commitment: Uint8Array, nonce: Uint8Array, alg: string, label: string }>}
 */
export function computeCommitment(data: ArrayBufferView | ArrayBuffer, opts?: {
    nonce?: ArrayBufferView | ArrayBuffer;
    nonceBytes?: number;
    hash?: "SHA3-256" | "SHA-256";
    label?: string;
}): Promise<{
    commitment: Uint8Array;
    nonce: Uint8Array;
    alg: string;
    label: string;
}>;
/**
 * Verify commitment matches given data+nonce with the same alg/label.
 * @returns {Promise<boolean>}
 */
export function verifyCommitment({ data, nonce, commitment, hash, label }: {
    data: any;
    nonce: any;
    commitment: any;
    hash?: string;
    label?: string;
}): Promise<boolean>;
/** Pack commitment+nonce to b64url strings for frames */
export function packCommitment({ commitment, nonce, alg, label }: {
    commitment: any;
    nonce: any;
    alg?: string;
    label?: string;
}): {
    commitment: string;
    nonce: string;
    alg: string;
    label: string;
};
/** Parse commitment+nonce from b64url strings */
export function parseCommitment(obj: any): {
    commitment: Uint8Array<ArrayBufferLike>;
    nonce: Uint8Array<ArrayBufferLike>;
    alg: any;
    label: any;
};
