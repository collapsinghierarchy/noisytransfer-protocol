export function browserWSWithReconnect(url: any, { maxRetries, backoffMs, protocols, wsConstructor }?: {
    maxRetries?: number;
    backoffMs?: number[];
}): {
    isConnected: boolean;
    onOpen(cb: any): () => boolean;
    onUp(cb: any): () => boolean;
    onDown(cb: any): () => boolean;
    onClose(cb: any): () => boolean;
    onMessage(cb: any): () => boolean;
    send(data: any): void;
    close(code?: number, reason?: string): void;
};
