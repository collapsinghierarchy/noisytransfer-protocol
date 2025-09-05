/**
 * Close DataChannel and PeerConnection *without* waiting on drain.
 * Removes handlers, stops transceivers, closes, then waits briefly for close.
 */
export function forceCloseNoFlush(tx: any, opts?: {}): Promise<void>;
/**
 * Optional: remove listeners and clear any intervals the tx may keep.
 * If your tx exposes an unsubscribe API, call it here.
 */
export function scrubTransport(tx: any): void;
