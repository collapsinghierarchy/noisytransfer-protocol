export function be32(n: any): Uint8Array<ArrayBuffer>;
export function aadFor(seq: any, ptLen: any): Uint8Array<ArrayBuffer>;
export function assertNumber(n: any, name: any): void;
export function validateManifest(m: any): void;
export function ctLenOfChunk(i: any, m: any): any;
export function ctTotalBytes(m: any): any;
export function ctOffsetOfChunk(i: any, m: any): number;
export function makeManifest({ aead, tagBytes, chunkBytes, totalBytes, counterStart, context, encTag, cipherDigest, finSigAlg, finSignature, }: {
    aead?: string;
    tagBytes?: number;
    chunkBytes: any;
    totalBytes: any;
    counterStart?: number;
    context?: {};
    encTag?: string;
    cipherDigest?: string;
    finSigAlg?: string;
    finSignature?: string;
}): {
    version: number;
    aead: string;
    tagBytes: number;
    chunkBytes: any;
    totalBytes: any;
    totalChunks: number;
    lastChunkPlaintextBytes: number;
    counterStart: number;
    encTag: string;
    cipherDigest: string;
    finSigAlg: string;
    finSignature: string;
    context: {
        chunkBytes: any;
        counterStart: number;
        aead: string;
    };
};
