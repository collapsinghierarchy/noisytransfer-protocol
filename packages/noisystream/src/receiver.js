import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { logger, b64u } from "@noisytransfer/util";
import { mkAeadStreamFromHpke, sha256, importVerifyKey, verifyChunk, sigInit, sigAddData, sigFinalize } from "@noisytransfer/crypto";

import {
  STREAM,
  parseStreamInit,
  packStreamReady,
  parseStreamData,
  parseStreamFin,
  packStreamFinAck,
  packStreamCredit,
} from "./frames.js";


// Same AAD id derivation as the sender (must match byte-for-byte).
const __te = new TextEncoder();
async function computeAadId({ dir, sessionId, totalBytes }) {
  const canon = { p:"noisystream", v:1, mode:"hpke", dir, sid:String(sessionId), tot:Number(totalBytes)>>>0 };
  const digest = await sha256(__te.encode(JSON.stringify(canon)));
  return b64u(digest);
}

/**
 * @typedef {{
 *   write:(u8:Uint8Array)=>any,
 *   close?:()=>any
 * }} WritableLike
 *
 * @typedef {{
 *   tx: { send:(f:any)=>void, onMessage:(cb:(f:any)=>void)=>()=>void, onClose?:(cb:()=>void)=>()=>void, close?:(...a:any[])=>void },
 *   sessionId: string,
 *   sink?: WritableLike | ((u8:Uint8Array)=>any),
 *   expectBytes?: number,
 *   abortSignal?: AbortSignal,
 *   onProgress?:(rcvd:number,total:number)=>void,
 *   // New flow control & crypto:
 *   backlogChunks?: number,
 *   backlogBytes?: number,
 *   windowChunks?: number,
 *   credit?: number,
 *   hpke?: { peerMaterial: any, ownPriv: any } // receiver uses encapsulation + own private key
 * }} RecvOpts
 */

/**
 * Stable API: recvFileWithAuth(...)
 * Waits ns_init → replies ns_ready → accepts ns_data (monotonic seq) → expects ns_fin.
 * @param {RecvOpts} opts
 * @returns {Promise<{ ok:true, bytes:number, frames:number, result?:Uint8Array }>}
 */
export async function recvFileWithAuth(opts) {
  const {
    tx,
    sessionId,
    sink,
    expectBytes,
    abortSignal,
    onProgress,
    backlogChunks = 0,
    backlogBytes = 0,
    windowChunks = 0,
    credit = 1,
  } = opts || {};

  if (!tx || typeof tx.onMessage !== "function" || typeof tx.send !== "function") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: missing/invalid tx" });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: sessionId required" });
  }
  if (expectBytes != null && !(Number.isInteger(expectBytes) && expectBytes >= 0 && Number.isSafeInteger(expectBytes))) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: expectBytes must be a safe non-negative integer when provided" });
  }

  logger.debug("[ns] receiver: starting", { sessionId, expectBytes, backlogChunks, backlogBytes, windowChunks, credit });
  const writer = makeSink(sink);
  let unsubMsg;
  const backlog = new Map();
  let backlogTotalBytes = 0;
  let lastWriteP = Promise.resolve();
  let unsubClose = null;
  let sigState = null;

  const state = {
    sawInit: false,
    ready: false,
    nextSeq: 0,
    frames: 0,
    bytes: 0,
    totalBytes: 0,
    fin: false,
    signatureVerified: false,
  };

  // E2EE state
  let dec = null;     // decryptor (HPKE stream)
  const doneP = new Promise((resolve, reject) => {
    unsubClose = tx.onClose?.(() => {
      reject(
        new NoisyError({
          code: "NC_TX_CLOSED",
          message: "transport closed mid-transfer",
          context: { sessionId },
        })
      );
    });

    let seenMaxSeq = -1;          // highest seq we've observed from incoming DATA
    let deliveredSeq = -1;        // last seq we've fully written to sink
    let deliveredSinceCredit = 0; // how many chunks delivered since last CREDIT grant

    logger.debug("[ns] receiver: waiting for INIT", { sessionId });
    unsubMsg = tx.onMessage(async (m) => {
      try {
        if (!m || m.sessionId !== sessionId) return;
        switch (m.type) {
          case STREAM.INIT: {
            if (state.sawInit) throw new NoisyError({ code: "NC_PROTOCOL", message: "duplicate init" });
            const init = parseStreamInit(m);
            state.sawInit = true;
            state.totalBytes = init.totalBytes;
            state.frames++;

            // HPKE-only: presence of hpkeEnc is authoritative
            if (!(init.hpkeEnc instanceof Uint8Array) || init.hpkeEnc.byteLength === 0) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "ns_init missing hpkeEnc" });
            }
            if (!opts.hpke.ownPriv) {
              throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing receiver HPKE private key" });
            }
            if (!writer || typeof writer.write !== "function") {
              throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: writer missing/invalid" });
            }
            if (!(typeof state.totalBytes === "number" && state.totalBytes >= 0 && Number.isSafeInteger(state.totalBytes))) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "ns_init.totalBytes invalid" });
            }
            const hpkeEnc = init.hpkeEnc;
            if (!(hpkeEnc instanceof Uint8Array) || hpkeEnc.byteLength === 0) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "missing hpkeEnc in ns_init" });
            }
            logger.debug("[ns] receiver: INIT received", { sessionId, totalBytes: state.totalBytes });
            // build HPKE stream (receiver role) with the same canonical AAD id
            const aadId = await computeAadId({ dir: "S2R", sessionId, totalBytes: state.totalBytes });
            dec = await mkAeadStreamFromHpke("receiver", hpkeEnc, opts.hpke.ownPriv, { id: aadId });
            sigState = await sigInit({ sessionId, totalBytes: state.totalBytes, hpkeEnc, aadId });
            logger.debug("[ns] receiver: sigInit inputs", {
              sessionId, totalBytes: state.totalBytes, aadId, hpkeEnc,
            });
            if (dec === null || !dec || typeof dec.open !== "function") {
              throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: failed to create decryptor" });
            }
            // respond ready (with credit features if enabled)
            safeSend(tx, packStreamReady({
              sessionId,
              totalBytes: state.totalBytes,
              features: (windowChunks > 0 ? { credit: true } : undefined),
              windowChunks: (windowChunks > 0 ? windowChunks : undefined)
            }));
            state.ready = true;
            logger.debug("[ns] receiver: READY sent", { sessionId, totalBytes: state.totalBytes, credit: windowChunks>0 });
            break;
          }

          case STREAM.DATA: {
            if (!state.ready) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "data before ready" });
            }
            const data = parseStreamData(m);
            // Initialization near state
            state.frames++;
            const seq = data.seq | 0;
            seenMaxSeq = Math.max(seenMaxSeq, seq);
            backlog.set(seq, data.chunk);
            backlogTotalBytes += data.chunk.byteLength;

            if (data.aead !== true) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "expected AEAD-encrypted ns_data" });
            }
            if (!(data.chunk instanceof Uint8Array) || data.chunk.byteLength === 0) {
              throw new NoisyError({ code: "NC_PROTOCOL", message: "ns_data.chunk must be non-empty bytes" });
            }

            const processInOrder = async () => {
              const ct = backlog.get(state.nextSeq);
              if (!ct) return false;

              const thisSeq = state.nextSeq;
              backlog.delete(thisSeq);
              backlogTotalBytes -= ct.byteLength;
              state.nextSeq++; // reserve immediately

              lastWriteP = lastWriteP.then(async () => {
                // update transcript with ciphertext in-order
                if (sigState) await sigAddData(sigState, thisSeq, ct);
                logger.debug("[ns] receiver: sigState updated", { thisSeq, sigState });

                const plain = await dec.open(ct);
                await writer.write(plain);

                state.bytes += plain.byteLength;
                deliveredSeq = thisSeq;
                deliveredSinceCredit += 1;

                try { onProgress?.(state.bytes, state.totalBytes); } catch {}

                if (windowChunks > 0) {
                  const inFlight = Math.max(0, seenMaxSeq - deliveredSeq);
                  const missing  = Math.max(0, windowChunks - inFlight);

                  if (deliveredSinceCredit >= credit && missing > 0) {
                    const grant = Math.min(deliveredSinceCredit, missing);
                    deliveredSinceCredit = 0;

                    const frame = packStreamCredit({ sessionId, chunks: grant });
                    queueMicrotask(() => {
                      try {
                        safeSend(tx, frame);
                      } catch (e) {
                        logger.warn("[ns] receiver: failed to send CREDIT", { err: e?.message, code: e?.code });
                      }
                    });
                  }
                }
              });

              return true;
            };
            // Buffer ciphertext; duplicates older than nextSeq are dropped
            if (seq < state.nextSeq) break; // drop duplicate
            backlog.set(seq, data.chunk);
            backlogTotalBytes += data.chunk.byteLength;
            // Enforce configured limits only if set
            if ((backlogChunks > 0 && backlog.size > backlogChunks) ||
                (backlogBytes > 0 && backlogTotalBytes > backlogBytes)) {
              throw new NoisyError({ code: "NC_BACKLOG_OVERFLOW", message: "receiver backlog overflow" });
           }
            // Drain in-order as far as possible
            while (await processInOrder()) {}
            break;
          }

          case STREAM.FIN: {
             const fin = parseStreamFin(m);
            if (sigState) {
              const digest = await sigFinalize(sigState, { frames: state.frames + 1, bytes: state.bytes });
              // prefer app-provided verify key; else use fin.sigPub, if present
              let verifyKey = opts.sign.verifyKey || (fin.sigPub ? await importVerifyKey(fin.sigPub) : null);
              if (fin.sig && verifyKey) {
                logger.debug("[ns] receiver: verifying stream signature", { digest: Buffer.from(digest).toString("hex") });
                const okSig = await verifyChunk(verifyKey, fin.sig, digest);
                if (!okSig) {
                  throw new NoisyError({ code: "NC_SIGNATURE_INVALID", message: "stream signature invalid" });
                }
                state.signatureVerified = true;
              }
            }
            // Make sure the previous DATA write (if any) has fully settled.
            await lastWriteP;
            state.frames++;
            if (!fin.ok) {
              throw new NoisyError({
                code: "NC_PROTOCOL",
                message: `sender fin not ok: ${fin.errCode || "unknown"}`,
              });
            }
            if (fin.ok === true && state.bytes !== state.totalBytes) {
              throw new NoisyError({
                code: "NC_PROTOCOL",
                message: "fin.ok=true but byte count mismatch",
                context: { have: state.bytes, expect: state.totalBytes },
              });
            }
            if (typeof expectBytes === "number" && expectBytes !== state.bytes) {
              throw new NoisyError({
                code: "NC_STREAM_MISMATCH",
                message: "byte count mismatch",
                context: { expected: expectBytes, got: state.bytes },
              });
            }
            if (state.totalBytes && state.bytes !== state.totalBytes) {
              throw new NoisyError({
                code: "NC_STREAM_MISMATCH",
                message: "received bytes differ from announced totalBytes",
                context: { totalBytes: state.totalBytes, got: state.bytes },
              });
            }
            try {
              writer.close?.();
            } catch {
              logger.warn("[ns] receiver: writer.close error");
            }
              try {
                safeSend(tx, packStreamFinAck({ sessionId }));
              } catch {
                logger.warn("[ns] receiver: failed to send FIN_ACK");
              }
            resolve({
              ok: true,
              bytes: state.bytes,
              frames: state.frames,
              result: writer.result?.(),
              signatureVerified: state.signatureVerified
            });
            break;
          }
          default:
            // ignore unrelated types
            logger.warn("[ns] receiver: ignoring unexpected frame", { type: m?.type, sessionId });
            break;
        }
      } catch (e) {
        reject(
          e instanceof NoisyError
            ? e
            : new NoisyError({ code: "NC_PROTOCOL", message: "recv error", cause: e })
        );
      }
    });
  });

  try {
    const res = await (abortSignal
      ? Promise.race([
          doneP,
          new Promise((_, rej) =>
            abortSignal.addEventListener(
              "abort",
              () => rej(new NoisyError({ code: "NC_ABORTED", message: "aborted" })),
              { once: true }
            )
          ),
        ])
      : doneP);
    logger.debug("[ns] receiver: complete", { sessionId, bytes: res.bytes, frames: res.frames });
    return res;
  } catch (err) {
    if (err instanceof NoisyError) throw err;
    throw new NoisyError({ code: "NC_UNKNOWN", message: "recvFileWithAuth failed", cause: err });
  } finally {
    try {
      unsubMsg?.();
    } catch {
      logger.warn("[ns] receiver: unsubMsg error");
    }
    try {
      unsubClose?.();
    } catch {
      logger.warn("[ns] receiver: unsubClose error");
    }
  }
}

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

/** Normalize sink to a WritableLike—or build an in-memory aggregator by default. */
function makeSink(sink) {
  // function(u8) style
  if (typeof sink === "function") {
    return {
      write: (u8) => sink(u8),
      close: () => {},
      result: () => undefined,
    };
  }
  // Writable-like with write/close
  if (sink && typeof sink.write === "function") {
    return {
      write: (u8) => sink.write(u8),
      close: () => {
        try {
          sink.close?.();
        } catch {}
      },
      result: () => undefined,
    };
  }
  // Default: in-memory aggregation (Uint8Array)
  const chunks = [];
  let total = 0;
  return {
    write: (u8) => {
      chunks.push(u8);
      total += u8.byteLength;
    },
    close: () => {},
    result: () => {
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    },
    async arrayBuffer() {
      const u8 = this.result();
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    },
  };
}
