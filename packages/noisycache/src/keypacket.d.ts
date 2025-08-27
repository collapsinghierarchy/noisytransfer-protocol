export function buildKeyPacket({ id, fk, baseIV, chunkSize, totalSize, chunks, hash }: {
    id: any;
    fk: any;
    baseIV: any;
    chunkSize: any;
    totalSize: any;
    chunks: any;
    hash: any;
}): Uint8Array<ArrayBuffer>;
export function parseKeyPacket(bytes: any): {
    id: string;
    fk: Uint8Array<any>;
    baseIV: Uint8Array<any>;
    chunkSize: number;
    totalSize: number;
    chunks: number;
    hash: string;
};
