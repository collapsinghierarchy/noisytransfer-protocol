import { NoisyError } from "@noisytransfer/errors/noisy-error.js";
import { logger } from "@noisytransfer/util/logger.js";
import { asU8, isByteLike } from "@noisytransfer/util/buffer.js";

import {
  STREAM,
  packStreamInit,  parseStreamReady,
  packStreamData,
  packStreamFin
} from "./frames.js";

/**
 * @typedef {{
 *   tx: { send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:(...a:any[])=>void },
 *   sessionId: string,
 *   source: Uint8Array|ArrayBuffer|Blob|AsyncIterable<Uint8Array|ArrayBuffer>|Iterable<Uint8Array|ArrayBuffer>,
 *   totalBytes?: number,               // required if source length cannot be derived
 *   chunkBytes?: number,               // default 64 KiB
 *   encTag?: Uint8Array|ArrayBuffer|null, // optional, echoed in ns_init
 *   onProgress?:(sent:number,total:number)=>void,
 *   abortSignal?: AbortSignal
 * }} SendOpts
 */

/**
 * Stable API: sendFileWithAuth(...)
 * Sends ns_init → waits ns_ready → streams ns_data(seq++) → sends ns_fin(ok).
 * @param {SendOpts} opts
 */
export async function sendFileWithAuth(opts) {
  const {
    tx, sessionId, source,
    totalBytes: totalBytesOpt,
    chunkBytes = 64 * 1024,
    encTag = null,
    onProgress,
    abortSignal
  } = opts || {};

  if (!tx || typeof tx.send !== "function") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: missing/invalid tx" });
  }
  if (typeof sessionId !== "string" || !sessionId) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: sessionId required" });
  }
  if (!source) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: source required" });
  }
  if (!(Number.isInteger(chunkBytes) && chunkBytes > 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: chunkBytes invalid" });
  }

  const { iter, totalBytesKnown, totalBytes } = makeChunkIterator(source, chunkBytes, totalBytesOpt);
  if (!totalBytesKnown && typeof totalBytesOpt !== "number") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: totalBytes must be provided for streaming sources" });
  }

  let unsubMsg = null;
  let unsubClose = null;
  let readyR = null;

  const cleanup = () => {
    try { unsubMsg?.(); } catch {}
    try { unsubClose?.(); } catch {}
  };

  if (abortSignal?.aborted) {
    throw new NoisyError({ code: "NC_ABORTED", message: "aborted before start" });
  }

  if (abortSignal) {
    const abortP = new Promise((_, rej) => {
      abortSignal.addEventListener("abort", () => {
        rej(new NoisyError({ code: "NC_ABORTED", message: "aborted" }));
      }, { once: true });
    });
    // race in a fire-and-forget manner by awaiting abortP whenever we await below
    // (we'll use Promise.race([... , abortP]) inline)
    readyR = abortP;
  }

  // 1) send ns_init
  const init = packStreamInit({ sessionId, totalBytes, encTag });
  safeSend(tx, init);

  // 2) wait for ns_ready
  await new Promise((resolve, reject) => {
    unsubClose = tx.onClose?.(() => {
      reject(new NoisyError({ code: "NC_TX_CLOSED", message: "transport closed before ready" }));
    });
    unsubMsg = tx.onMessage((m) => {
      try {
        if (!m || m.type !== STREAM.READY || m.sessionId !== sessionId) return;
        const r = parseStreamReady(m);
        logger.debug("[ns] sender: got READY", r);
        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  });

  // 3) stream data
  let sent = 0;
  let seq = 0;
  for await (const chunk of iter) {
    if (abortSignal?.aborted) throw new NoisyError({ code: "NC_ABORTED", message: "aborted" });
    const u8 = asU8(chunk);
    safeSend(tx, packStreamData({ sessionId, seq, chunk: u8 }));
    seq++;
    sent += u8.byteLength;
    try { onProgress?.(sent, totalBytes); } catch {}
  }

  // 4) fin
  safeSend(tx, packStreamFin({ sessionId, ok: true }));

  cleanup();
  logger.debug("[ns] sender: complete", { sessionId, bytes: sent, frames: seq + 2 /*init+fin*/ });
  return { ok: true, bytesSent: sent, frames: seq + 2 };
}

/** internal: single-arg send with error mapping */
function safeSend(tx, frame) {
  try {
    tx.send(frame);
  } catch (err) {
    throw new NoisyError({ code: "NC_TX_SEND", message: "send failed", context: { type: frame?.type }, cause: err, retriable: true });
  }
}

/** Build a chunk iterator over supported sources. */
function makeChunkIterator(source, chunkBytes, totalBytesOpt) {
  // Blob
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const total = source.size;
    async function* gen() {
      let off = 0;
      while (off < total) {
        const next = Math.min(off + chunkBytes, total);
        const buf = new Uint8Array(await source.slice(off, next).arrayBuffer());
        yield buf;
        off = next;
      }
    }
    return { iter: gen(), totalBytesKnown: true, totalBytes: total };
  }

  // Byte-like buffer
  if (isByteLike(source)) {
    const u8full = asU8(source);
    const total = u8full.byteLength;
    async function* gen() {
      for (let off = 0; off < total; off += chunkBytes) {
        const next = Math.min(off + chunkBytes, total);
        yield u8full.subarray(off, next);
      }
    }
    return { iter: gen(), totalBytesKnown: true, totalBytes: total };
  }

  // (Async)Iterable of chunks
  if (isAsyncIterable(source) || isSyncIterable(source)) {
    const total = (typeof totalBytesOpt === "number" && totalBytesOpt >= 0) ? totalBytesOpt : 0;
    // normalize to async iterator
    const iter = (async function* () {
      for await (const c of source) yield asU8(c);
    })();
    return { iter, totalBytesKnown: typeof totalBytesOpt === "number", totalBytes: total };
  }

  throw new NoisyError({ code: "NC_BAD_PARAM", message: "unsupported source type" });
}

const isAsyncIterable = (x) => x && typeof x[Symbol.asyncIterator] === "function";
const isSyncIterable  = (x) => x && typeof x[Symbol.iterator] === "function";
