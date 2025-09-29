import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { flush as flushTx } from "@noisytransfer/transport";
import { asU8, isByteLike, logger, b64u } from "@noisytransfer/util";
import { mkAeadStreamFromHpke, sha256, sigInit, sigAddData, sigFinalize, signChunk } from "@noisytransfer/crypto"
import {
  STREAM,
  packStreamInit,
  parseStreamReady,
  packStreamData,
  packStreamFin,
  parseStreamFinAck,
  parseStreamCredit
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
 *   abortSignal?: AbortSignal,
 *   finAckTimeoutMs?: number,
 *   finAckMaxRetries?: number,
 *   finAckBackoffMs?: number,
 *   adaptiveChunking?: boolean,
 *   hpke?: { peerMaterial: any }, // receiver's public key (sender role)
 * }} SendOpts
 */

// Derive a stable AAD id bound to protocol/version/direction/session/length.
// Produces a short ASCII token via base64url(SHA-256(JSON)).
const __te = new TextEncoder();
/**
 * Compute canonical stream id bound into HPKE AAD.
 * base64url(SHA-256(JSON({p:"noisystream",v:1,mode:"hpke",dir,sid,tot})))
 * @param {{dir:"S2R"|"R2S", sessionId:string, totalBytes:number}} p
 * @returns {Promise<string>}
 */
async function computeAadId({ dir, sessionId, totalBytes }) {
  const canon = {
    p: "noisystream", // protocol label
    v: 1,             // protocol version
    mode: "hpke",     // crypto mode 
    dir,              // "S2R" for this stream
    sid: String(sessionId),
    tot: Number(totalBytes) >>> 0,
  };
  const digest = await sha256(__te.encode(JSON.stringify(canon)));
  return b64u(digest);
}

/**
 * Stable API: sendFileWithAuth(...)
 * Flow: INIT → READY → DATA* → FIN → FIN_ACK (bounded retries).
 * - Creates one HPKE sender context and reuses it for all chunks.
 * - Respects optional credit-based flow control advertised by the receiver.
 * - Optionally signs the transcript at FIN (RSA-PSS by default).
 *
 * @param {import("./types.js").SendOpts} opts
 * @returns {Promise<{ ok: true, bytes: number, frames: number }>}
 */
export async function sendFileWithAuth(opts) {
  const {
    tx,
    sessionId,
    source,
    totalBytes: totalBytesOpt,
    chunkBytes = 64 * 1024,
    encTag = null,
    onProgress,
    abortSignal,
    finAckTimeoutMs = 5000,
    finAckMaxRetries = 3,
    finAckBackoffMs = 100,
    adaptiveChunking = false,
    maxBufferedBytes = undefined,
  } = opts || {};

  logger.debug("[ns] sender: sendFileWithAuth called", { sessionId, totalBytesOpt, chunkBytes, encTag });
  // Sanity checks
  if (!tx || typeof tx.send !== "function") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: missing/invalid tx" });
  }
  if (typeof tx.readyState === "string" && tx.readyState !== "open") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: `sendFileWithAuth: tx not open (got ${tx.readyState})` });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: sessionId required" });
  }
  if (!source) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: source required" });
  }
  if (!(Number.isInteger(chunkBytes) && chunkBytes > 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: chunkBytes invalid" });
  }
  if (totalBytesOpt != null && !(Number.isInteger(totalBytesOpt) && totalBytesOpt >= 0 && Number.isSafeInteger(totalBytesOpt))) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: totalBytes must be a safe non-negative integer when provided" });
  }
  if (!(Number.isInteger(finAckTimeoutMs) && finAckTimeoutMs >= 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: finAckTimeoutMs must be a non-negative integer" });
  }
  if (!(Number.isInteger(finAckMaxRetries) && finAckMaxRetries >= 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: finAckMaxRetries must be a non-negative integer" });
  }
  if (!(Number.isInteger(finAckBackoffMs) && finAckBackoffMs >= 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: finAckBackoffMs must be a non-negative integer" });
  }
  if (maxBufferedBytes !== undefined && !(Number.isInteger(maxBufferedBytes) && maxBufferedBytes > 0)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: maxBufferedBytes must be a positive integer when provided" });
  }
// Validate source shape: ReadableStream | (Async)Iterable | Blob | ArrayBuffer(View) 
  const isReadableStream = !!source?.getReader && typeof source.getReader === "function";
  const isAsyncIterable = !!source?.[Symbol.asyncIterator];
  const isBlobLike = !!source?.arrayBuffer && typeof source.arrayBuffer === "function" && Number.isInteger(source?.size ?? 0);
  const isArrayBuffer = (typeof ArrayBuffer !== "undefined" && source instanceof ArrayBuffer);
  const isU8 = (typeof Uint8Array !== "undefined" && source instanceof Uint8Array);
  if (!(isReadableStream || isAsyncIterable || isBlobLike || isArrayBuffer || isU8)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: source must be ReadableStream | AsyncIterable | Blob/File | ArrayBuffer | Uint8Array" });
  }
  // HPKE is mandatory
  if (!opts.hpke || !(opts.hpke.peerMaterial instanceof Uint8Array || opts.hpke.peerMaterial instanceof ArrayBuffer)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: hpke.peerMaterial (recipient KEM public key bytes) required" });
  }
  if (encTag != null && !(encTag instanceof Uint8Array || encTag instanceof ArrayBuffer)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: encTag must be bytes when provided" });
  }
  if (abortSignal && typeof abortSignal.aborted !== "boolean") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: abortSignal invalid" });
  }

  if (abortSignal?.aborted) {
    throw new NoisyError({ code: "NC_ABORTED", message: "aborted before start" });
  }

  if (abortSignal) {
    const abortP = new Promise((_, rej) => {
      abortSignal.addEventListener(
        "abort",
        () => {
          rej(new NoisyError({ code: "NC_ABORTED", message: "aborted" }));
        },
        { once: true }
      );
    });
  }

  // 1) prepare and validate source iterator
  // For streaming sources (AsyncIterable/Iterable), `totalBytes` is REQUIRED and becomes
  // the authoritative value advertised in INIT.totalBytes. For buffer-like sources
  // (Uint8Array/ArrayBuffer/Blob), the derived length is used instead.
  const { iter, totalBytesKnown, totalBytes } = makeChunkIterator(
    source,
    chunkBytes,
    totalBytesOpt
  );

  if (!totalBytesKnown && typeof totalBytesOpt !== "number") {
    throw new NoisyError({
      code: "NC_BAD_PARAM",
      message: "sendFileWithAuth: totalBytes must be provided for streaming sources",
    });
  }

  // Unsubscribe handles for the short-lived listeners we attach while waiting for
  // specific frames (e.g. READY / FIN_ACK). We stash the unsubscribe fns here and
  // call cleanup() after each wait phase to avoid leaking handlers or double-firing.
  // Optional chaining + try/catch makes cleanup idempotent and safe even if the
  // transport is already closed or an unsubscribe was called earlier.
  let unsubMsg = null;
  let unsubClose = null;
  const cleanup = () => {
    try {
      unsubMsg?.();
    } catch {}
    try {
      unsubClose?.();
    } catch {}
  };

  // E2EE state
  let hpkeSend = null;           // encryptor (HPKE stream or AES-GCM)
  let seqHigh = -1;  
  let aadId = null;       // cached high-32 for non-HPKE path

  if (opts.hpke.peerMaterial) {
    // build HPKE stream (sender role) with canonical AAD id
    aadId = await computeAadId({ dir: "S2R", sessionId, totalBytes });
    hpkeSend = await mkAeadStreamFromHpke("sender", opts.hpke.peerMaterial, undefined,{ id: aadId });
  } else {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "HPKE peerMaterial (recipient KEM public key) required" });
  }
  if (hpkeSend === null || !hpkeSend || typeof hpkeSend.seal !== "function" || hpkeSend.enc.byteLength === 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "sendFileWithAuth: failed to create encryptor" });
  }
  // sanity: enforce same id
  if (hpkeSend.id !== aadId) {
    throw new NoisyError({
      code: "NC_INTERNAL",
      message: "AAD id mismatch on sender (mkAeadStreamFromHpke ignored opts.id)",
      context: { expected: aadId, got: hpkeSend.id }
    });
  }
  // transcript init
  const sigState = await sigInit({
    sessionId, totalBytes, hpkeEnc: asU8(hpkeSend.enc), aadId
  });
  logger.debug("[ns] sender: sigInit inputs", {
    sid: sessionId,
    totalBytes,
    aadId,
    hpkeEnc: asU8(hpkeSend.enc),
  });
  logger.debug("[ns] sender: starting", { sessionId, totalBytes, chunkBytes, encTag, sigState });
  const init = packStreamInit({
    sessionId, totalBytes, encTag, hpkeEnc: hpkeSend.enc
  });
  logger.debug("[ns] sender: sending INIT", { sessionId, totalBytes, encTag });
  safeSend(tx, init);
  let creditEnabled = false;
  let credit = Infinity;

  // 2) wait for ns_ready
  logger.debug("[ns] sender: waiting for READY", { sessionId });
  await new Promise((resolve, reject) => {
    unsubClose = tx.onClose?.(() => {
      reject(new NoisyError({ code: "NC_TX_CLOSED", message: "transport closed before ready" }));
    });
    unsubMsg = tx.onMessage((m) => {
       if (!m || m.sessionId !== sessionId) return;
       if (m.type === STREAM.READY) {
        try {
        const r = parseStreamReady(m);
          logger.debug("[ns] sender: got READY", r);
          // credit window support
          if (r && r.features && r.features.credit === true) {
            credit = Number.isFinite(r.windowChunks) ? (r.windowChunks|0) : 0;
            creditEnabled = true;
          }
          resolve(true);
       } catch (e) {
        reject(e);
      }
    } else if (m.type === STREAM.CREDIT) {
        try {
          logger.debug("[ns] sender: got CREDIT", m);
          const c = parseStreamCredit(m);
          if (creditEnabled) credit += c.chunks|0;
        } catch {
          logger.warn("[ns] sender: invalid CREDIT frame");
        }
      }
    
    });
  });

  // 3) stream data (optional adaptive chunk sizing, optional credit gating)
  let sent = 0;
  let seq = 0;
  let curChunk = chunkBytes;
  for await (const chunk of iter) {
    if (abortSignal?.aborted) throw new NoisyError({ code: "NC_ABORTED", message: "aborted" });
    const u8 = asU8(chunk);
    // Credit gating
    while (creditEnabled && credit <= 0) {
      await new Promise((r) => setTimeout(r, 1));
      if (abortSignal?.aborted) throw new NoisyError({ code: "NC_ABORTED", message: "aborted" });
    }
    if (creditEnabled) credit--;
    // Throttle on RTCDataChannel.bufferedAmount if provided in tx
    try {
      const dc = tx?.dc || tx?.datachannel || tx?.dataChannel || null;
      if (maxBufferedBytes && dc && typeof dc.bufferedAmount === "number") {
       const low = Math.max(16384, Math.floor(maxBufferedBytes / 2));
        if (typeof dc.bufferedAmountLowThreshold === "number") dc.bufferedAmountLowThreshold = low;
        while (dc.bufferedAmount > maxBufferedBytes) {
          await new Promise((res) => {
            const h = () => {
              logger.debug("[ns] sender: bufferedAmount low event", { bufferedAmount: dc.bufferedAmount, threshold: dc.bufferedAmountLowThreshold });
              dc.removeEventListener?.("bufferedamountlow", h);
              res();
            };
            if (typeof dc.addEventListener === "function") {
              dc.addEventListener("bufferedamountlow", h, { once: true });
            } else {
            // fallback polling
              setTimeout(h, 5);
            }
          });
        }
      }
      logger.debug("[ns] sender: sending chunk", { seq, bytes: u8.byteLength, bufferedAmount: dc?.bufferedAmount });
    } catch {
      logger.warn("[ns] sender: failed to throttle on bufferedAmount");
    }

    if (!(u8 instanceof Uint8Array)) {
      throw new NoisyError({ code: "NC_INTERNAL", message: "sendFileWithAuth: chunk to seal must be Uint8Array" });
    }
    // HPKE stream handles nonce/seq internally, per-context.
    const ct = await hpkeSend.seal(u8); 
    safeSend(tx, packStreamData({ sessionId, seq, chunk: ct, aead: true }));
    logger.debug("[ns] sender: sent chunk", { seq, bytes: u8.byteLength });
    if (!creditEnabled && !maxBufferedBytes) {
      await safeFlush(tx, { resolveOnClose: true });
    }
    // include ciphertext in transcript (order is seq)
    await sigAddData(sigState, seq, ct);
    logger.debug("[ns] sender: sigState updated", { seq, sigState });
    seq++;
    sent += u8.byteLength;
    try {
      onProgress?.(sent, totalBytes);
      logger.debug("[ns] sender: progress", { sent, totalBytes });
    } catch {}
    if (adaptiveChunking) {
      if (typeof tx.bufferedAmountLowThreshold !== "number") {
        throw new NoisyError({ code: "NC_BAD_PARAM", message: "adaptiveChunking requires tx.bufferedAmountLowThreshold support" });
      }
      if (typeof tx.bufferedAmount !== "number") {
        throw new NoisyError({ code: "NC_BAD_PARAM", message: "adaptiveChunking requires tx.bufferedAmount counter" });
      }
      // Nudge chunk size between 32–128 KiB based on bufferedAmount heuristic
      const buf = tx.bufferedAmount;
      if (buf > 1_048_576) curChunk = Math.max(32 * 1024, (curChunk / 2) | 0);
      else if (buf < 128 * 1024) curChunk = Math.min(128 * 1024, curChunk * 2);
      // Generators for Blob/byte-like honor external `chunkBytes` by ref only if implemented to re-read size.
      // For iterable sources, users can pre-chunk; this is a best-effort heuristic.
    }
  }
  logger.debug("[ns] sender: source complete", { sent, totalBytes, seq });
  // Best-effort flush; FIN/ACK governs correctness, not this flush
  await safeFlush(tx, { timeoutMs: 3000, resolveOnClose: true });
    // resend FIN with bounded backoff until ACK or timeout
  let tries = 0;
  let done = false;
  const unsub = tx.onMessage((m) => {
    if (!m || m.type !== STREAM.FIN_ACK || m.sessionId !== sessionId) return;
    try {
      parseStreamFinAck(m);
      done = true;
    } catch {
      // ignore invalid FIN_ACK
      logger.warn("[ns] sender: invalid FIN_ACK");
    }
  });
    try {
      let finSig, finAlg, finPub;
      const framesCount = seq + 2; // init + fin
      const digest = await sigFinalize(sigState, { frames: framesCount, bytes: sent });
      if (opts.sign.privateKey) {
        logger.debug("[ns] sender: digest to sign", { digest: Buffer.from(digest).toString("hex") });
        finSig = await signChunk(opts.sign.privateKey, digest);
        finAlg = opts.sign.alg || "RSA-PSS-3072-SHA256";
        if (opts.sign.publicKeySpki instanceof Uint8Array) finPub = opts.sign.publicKeySpki;
      }
      while (!done && tries <= finAckMaxRetries) {
        const finFrame = packStreamFin({ sessionId, ok: true, sig: finSig, sigAlg: finAlg, sigPub: finPub });
        safeSend(tx, finFrame);
        // wait for ack or per-try timeout
        await Promise.race([
          new Promise((res) => setTimeout(res, finAckTimeoutMs)),
          (async () => {
            while (!done) await new Promise((r) => setTimeout(r, 5));
          })(),
        ]);
        if (done) break;
        tries++;
        await new Promise((r) =>
          setTimeout(r, Math.min(1000, finAckBackoffMs * (1 << (tries - 1))))
        );
      }
      if (!done)
        throw new NoisyError({
          code: "NC_SIGNAL_RETRIES",
          message: "FIN/ACK not received before timeout",
          context: { tries, finAckTimeoutMs },
        });
    } finally {
      try {
        unsub?.();
      } catch {
        logger.warn("[ns] sender: failed to unsubscribe");
        // ignore
      }
    }

  cleanup();
  logger.debug("[ns] sender: complete", { sessionId, bytes: sent, frames: seq + 2 /*init+fin*/ });
  return { ok: true, bytesSent: sent, frames: seq + 2 };
}

//internal
async function safeFlush(tx, opts) {
  try {
    await flushTx(tx, opts);
  } catch (err) {
    // Ignore harmless flush timeouts; rely on FIN/ACK ordering for delivery
    if (!(err && err.code === "NC_TRANSPORT_FLUSH_TIMEOUT")) throw err;
  }
}

/** internal: single-arg send with error mapping */
function safeSend(tx, frame) {
  try {
    tx.send(frame);
  } catch (err) {
    throw new NoisyError({
      code: "NC_TX_SEND",
      message: "send failed",
      context: { type: frame?.type },
      cause: err,
      retriable: true,
    });
  }
}

/**
 * Normalize arbitrary sources (Blob | (Async)Iterable | Uint8Array | ArrayBuffer)
 * into an async iterator of Uint8Array, and report totalBytes when known.
 * @param {any} source
 * @param {number} chunkBytes
 * @param {number|undefined} totalBytesOpt
 * @returns {{ iter: AsyncIterable<Uint8Array>, totalBytesKnown: boolean, totalBytes: number }}
 */
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
    const total = typeof totalBytesOpt === "number" && totalBytesOpt >= 0 ? totalBytesOpt : 0;
    // normalize to async iterator
    const iter = (async function* () {
      for await (const c of source) yield asU8(c);
    })();
    return { iter, totalBytesKnown: typeof totalBytesOpt === "number", totalBytes: total };
  }

  throw new NoisyError({ code: "NC_BAD_PARAM", message: "unsupported source type" });
}

const isAsyncIterable = (x) => x && typeof x[Symbol.asyncIterator] === "function";
const isSyncIterable = (x) => x && typeof x[Symbol.iterator] === "function";
