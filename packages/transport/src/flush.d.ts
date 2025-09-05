/**
 * Best-effort drain of a Transport.
 *
 * Strategy:
 *  1) If tx.flush exists, call it (ignore errors).
 *  2) If a DataChannel is reachable (tx.dc or tx._dc), poll bufferedAmount down.
 *     Do not rely on 'bufferedamountlow' in Node.
 *  3) If a generic tx.bufferedAmount exists, poll it down.
 *
 * Options:
 *  - timeoutMs:     max time to wait (default 15000 or env NOISY_TRANSPORT_FLUSH_TIMEOUT_MS)
 *  - intervalMs:    polling interval (default 10ms)
 *  - lowThreshold:  consider “drained-enough” once <= this (default 64*1024)
 *  - resolveOnClose: if channel closes while draining, resolve (default true)
 *  - requireProgressMs: if no progress for this long, bail early (default 750ms)
 */
export function flush(tx: any, opts?: {}): Promise<void>;
