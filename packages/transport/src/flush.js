// packages/transport/src/flush.js
import { NoisyError } from "@noisytransfer/errors/noisy-error";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
export async function flush(tx, opts = {}) {
  const timeoutMs =
    +process.env.NOISY_TRANSPORT_FLUSH_TIMEOUT_MS > 0
      ? +process.env.NOISY_TRANSPORT_FLUSH_TIMEOUT_MS
      : Number.isFinite(opts.timeoutMs)
        ? opts.timeoutMs
        : 15000;
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 10;
  const lowThreshold = Number.isFinite(opts.lowThreshold) ? opts.lowThreshold : 64 * 1024;
  const resolveOnClose = opts.resolveOnClose !== false; // default true
  const requireProgressMs = Number.isFinite(opts.requireProgressMs) ? opts.requireProgressMs : 750;

  let timeoutId;
  const guard = new Promise((_, rej) => {
    timeoutId = setTimeout(() => {
      rej(
        new NoisyError({
          code: "NC_TRANSPORT_FLUSH_TIMEOUT",
          message: "Transport flush timed out",
          context: { timeoutMs },
        })
      );
    }, timeoutMs);
  });

  const work = (async () => {
    // 1) native flush
    if (typeof tx.flush === "function") {
      try {
        await tx.flush();
      } catch {}
    }

    // pick a DC if available
    const dc = tx?.dc ?? tx?._dc;
    const hasDC = dc && typeof dc.bufferedAmount === "number";

    // helper: poll a number accessor
    async function pollNumber(get, isClosed) {
      let last = get();
      let lastChange = Date.now();

      // small grace: once below lowThreshold, give it a short chance to reach 0
      const maybeSettle = async () => {
        const deadline = Date.now() + 100;
        while (get() > 0 && Date.now() < deadline) await sleep(intervalMs);
      };

      while (true) {
        const val = get();

        if (val <= lowThreshold) {
          await maybeSettle();
          if (get() <= lowThreshold) return; // drained enough
        }

        if (val !== last) {
          last = val;
          lastChange = Date.now();
        } else if (Date.now() - lastChange > requireProgressMs) {
          // No progress for too long.
          if (resolveOnClose && isClosed()) return;
          // else, let the top-level timeout fire to signal hard error
        }

        if (resolveOnClose && isClosed()) return;

        await sleep(intervalMs);
      }
    }

    if (hasDC) {
      const isClosed = () => dc.readyState === "closing" || dc.readyState === "closed";
      await pollNumber(() => dc.bufferedAmount, isClosed);
      return;
    }

    // 3) generic bufferedAmount
    if (typeof tx.bufferedAmount === "number") {
      const isClosed = () => false;
      await pollNumber(() => tx.bufferedAmount, isClosed);
    }
  })();

  try {
    await Promise.race([work, guard]);
  } finally {
    clearTimeout(timeoutId);
  }
}
