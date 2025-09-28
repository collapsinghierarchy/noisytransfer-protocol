/**
 * Return a Transport facade immediately; connect later when an offer arrives.
 */
export function rtcResponder(signal: any, rtcCfg?: {}, opts?: {}): {
    readonly isConnected: boolean;
    readonly isUp: boolean;
    onUp(cb: any): () => boolean;
    onDown(cb: any): () => boolean;
    onClose(cb: any): () => boolean;
    onMessage(cb: any): () => boolean;
    readonly bufferedAmount: number;
    flush(): Promise<void>;
    getLocalFingerprint(): {
        alg: string;
        bytes: Uint8Array<ArrayBuffer>;
    };
    getRemoteFingerprint(): {
        alg: string;
        bytes: Uint8Array<ArrayBuffer>;
    };
    features: {
        durableOrdered: boolean;
        ordered: boolean;
        reliable: boolean;
        peerFingerprints: () => any;
    } | undefined;
    send(_: any): void;
    close(code?: number, reason?: string): Promise<void>;
};
