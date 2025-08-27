/**
 * Return a Transport facade immediately; connect later when an offer arrives
 * over the signalling transport. Until the DataChannel is open, send() throws
 * NC_TRANSPORT_DOWN and isConnected = false.
 */
export function rtcResponder(signal: any, rtcCfg?: {}): {
    readonly isConnected: boolean;
    readonly isUp: boolean;
    onUp(cb: any): () => boolean;
    onDown(cb: any): () => boolean;
    onClose(cb: any): () => boolean;
    onMessage(cb: any): () => boolean;
    getLocalFingerprint(): {
        alg: string;
        bytes: Uint8Array<ArrayBuffer>;
    };
    getRemoteFingerprint(): {
        alg: string;
        bytes: Uint8Array<ArrayBuffer>;
    };
    send(_: any): never;
    close(code?: number, reason?: string): void;
};
