type TxLike = {
    send: (f: any) => void;
    onMessage: (cb: (f: any) => void) => () => void;
    onClose?: (cb: () => void) => () => void;
    close?: () => void;
};
type WritableLike = {
    write: (u8: Uint8Array) => any;
    close?: () => any;
};
type SendOpts = {
    tx: TxLike;
    sessionId: string;
    source: Uint8Array | ArrayBuffer | Blob | AsyncIterable<Uint8Array | ArrayBuffer> | Iterable<Uint8Array | ArrayBuffer>;
    totalBytes?: number | undefined;
    chunkBytes?: number | undefined;
    encTag?: (Uint8Array | ArrayBuffer | null) | undefined;
    onProgress?: ((sent: number, total: number) => void) | undefined;
    abortSignal?: AbortSignal | undefined;
    finAck?: boolean | undefined;
    finAckTimeoutMs?: number | undefined;
    finAckMaxRetries?: number | undefined;
    finAckBackoffMs?: number | undefined;
    adaptiveChunking?: boolean | undefined;
};
type RecvOpts = {
    tx: TxLike;
    sessionId: string;
    sink?: (WritableLike | ((u8: Uint8Array) => any)) | undefined;
    expectBytes?: number | undefined;
    abortSignal?: AbortSignal | undefined;
    onProgress?: ((rcvd: number, total: number) => void) | undefined;
};
