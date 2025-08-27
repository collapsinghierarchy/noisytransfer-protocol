export function createAuthReceiver(tx: any, hooks?: {}, opts?: {}): {
    close: () => void;
    getState: () => "IDLE";
    onState: (cb: any) => () => boolean;
};
