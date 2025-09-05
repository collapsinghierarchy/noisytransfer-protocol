import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { logger } from "@noisytransfer/util/logger";

import {
  STREAM,
  parseStreamInit,
  packStreamReady,
  parseStreamData,
  parseStreamFin,
  packStreamFinAck,
} from "./frames.js";

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
 *   expectBytes?: number,         // optional extra guard against short/long transfers
 *   abortSignal?: AbortSignal,
 *   onProgress?:(rcvd:number,total:number)=>void,
 *   finAck?: boolean
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
    finAck = false,
    accept,
  } = opts || {};
  if (!tx || typeof tx.onMessage !== "function" || typeof tx.send !== "function") {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: missing/invalid tx" });
  }
  if (typeof sessionId !== "string" || !sessionId) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "recvFileWithAuth: sessionId required" });
  }

  const writer = makeSink(sink);
  let unsubMsg = null;
  let unsubClose = null;

  const state = {
    sawInit: false,
    ready: false,
    totalBytes: 0,
    nextSeq: 0,
    bytes: 0,
    frames: 0,
  };

  // Ensure DATA writes are processed strictly before FIN validation
  let lastWriteP = Promise.resolve();

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

    unsubMsg = tx.onMessage(async (m) => {
      try {
        if (!m || m.sessionId !== sessionId) return;

        switch (m.type) {
          case STREAM.INIT: {
            const init = parseStreamInit(m);
            if (state.sawInit)
              throw new NoisyError({ code: "NC_PROTOCOL", message: "duplicate init" });
            state.sawInit = true;
            state.totalBytes = init.totalBytes;
            state.frames++;
            // respond ready
            safeSend(tx, packStreamReady({ sessionId }));
            state.ready = true;
            logger.debug("[ns] receiver: READY sent", { sessionId, totalBytes: state.totalBytes });
            // accept hooks (optional)
            try {
              if (accept && typeof accept.onRequest === "function") {
                const ok = await accept.onRequest({
                  sessionId,
                  totalBytes: state.totalBytes,
                  encTag: init.encTag,
                });
                if (ok === false)
                  throw new NoisyError({
                    code: "NC_PROTOCOL",
                    message: "request rejected by receiver",
                  });
              }
              if (accept && typeof accept.onStart === "function") {
                try {
                  await accept.onStart({ sessionId, totalBytes: state.totalBytes });
                } catch {}
              }
            } catch {}
            break;
          }

          case STREAM.DATA: {
            if (!state.ready)
              throw new NoisyError({ code: "NC_PROTOCOL", message: "data before ready" });
            const data = parseStreamData(m);
            if (data.seq !== state.nextSeq) {
              throw new NoisyError({
                code: "NC_PROTOCOL",
                message: "non-monotonic seq",
                context: { expected: state.nextSeq, got: data.seq },
              });
            }
            state.frames++;
            const u8 = data.chunk;
            // Serialize writes & counters so FIN can await completion cleanly
            lastWriteP = lastWriteP.then(async () => {
              await writer.write(u8);
              state.nextSeq++;
              state.bytes += u8.byteLength;
              try {
                onProgress?.(state.bytes, state.totalBytes);
              } catch {}
              try {
                accept?.onChunk?.(u8);
              } catch {}
              return true
            });
            break;
          }

          case STREAM.FIN: {
            const fin = parseStreamFin(m);
            // Make sure the previous DATA write (if any) has fully settled.
            await lastWriteP;
            state.frames++;
            if (!fin.ok) {
              throw new NoisyError({
                code: "NC_PROTOCOL",
                message: `sender fin not ok: ${fin.errCode || "unknown"}`,
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
            } catch {}
            // accept.finish hook (provide a readable sink)
            try {
              if (accept && typeof accept.finish === "function") {
                const sinkHandle = {
                  async arrayBuffer() {
                    const u8 = writer.result?.() || new Uint8Array(0);
                    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                  },
                };
                await accept.finish({ sink: sinkHandle });
              }
            } catch {}
            if (finAck) {
              try {
                safeSend(tx, packStreamFinAck({ sessionId }));
              } catch {}
            }
            resolve({
              ok: true,
              bytes: state.bytes,
              frames: state.frames,
              result: writer.result?.(),
            });
            break;
          }

          default:
            // ignore unrelated types
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
  } finally {
    try {
      accept?.close?.();
    } catch {}
    try {
      unsubMsg?.();
    } catch {}
    try {
      unsubClose?.();
    } catch {}
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
