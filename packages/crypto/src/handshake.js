import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { withTimeout, asU8, toU8 } from "@noisytransfer/util";
import { suite } from "./suite.js";
/**
 * @typedef {Object} SenderSession
 * @property {(pt: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer) => Promise<Uint8Array>} seal
 * @property {Uint8Array} enc
 * @property {(info: Uint8Array|ArrayBuffer, len: number) => Promise<Uint8Array>=} exportSecret
 * @property {SenderSession["seal"]} hpkeSeal
 */
/**
 * @typedef {Object} ReceiverSession
 * @property {(ct: Uint8Array|ArrayBuffer, aad?: Uint8Array|ArrayBuffer) => Promise<Uint8Array>} open
 * @property {(info: Uint8Array|ArrayBuffer, len: number) => Promise<Uint8Array>=} exportSecret
 * @property {ReceiverSession["open"]} hpkeOpen
 */

/**
 * Create a long-lived HPKE sender context (one encapsulation, many messages).
 * All outputs are normalized to Uint8Array and concurrent seal() calls are serialized.
 * @param {Uint8Array|ArrayBuffer} receiverPublicKey - recipient public key bytes (suite.kem.serializePublicKey)
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<SenderSession>}
 */
export async function createSenderSession(receiverPublicKey, { timeoutMs = 30_000 } = {}) {
  const pkBytes = toU8(receiverPublicKey);
  const pk = await suite.kem.deserializePublicKey(pkBytes);

  // One encapsulation here; reuse the context afterward
  const ctx = await withTimeout(
    suite.createSenderContext({ recipientPublicKey: pk }),
    timeoutMs
  );

  // Serialize all encryptions on this context
  let sendQueue = Promise.resolve();

  const seal = (pt, aad) => {
    const job = async () => {
      const buf = await withTimeout(
        ctx.seal(asU8(pt), aad ? asU8(aad) : undefined),
        timeoutMs
      );
      return toU8(buf); // normalize to Uint8Array
    };
    // Chain to the queue and return the *result* promise
    sendQueue = sendQueue.then(job, job);
    return sendQueue;
  };

  const exportSecret =
    typeof ctx.export === "function"
      ? async (info, len) =>
          toU8(await withTimeout(ctx.export(asU8(info), len), timeoutMs))
      : undefined;

  return {
    seal,
    hpkeSeal: seal, // back-compat alias
    exportSecret,
    enc: toU8(ctx.enc), // send once with the first message
  };
}

/**
 * Create a long-lived HPKE recipient context.
 * All outputs are normalized to Uint8Array and concurrent open() calls are serialized.
 * @param {Uint8Array|ArrayBuffer} enc - sender's encapsulated key (sender.enc)
 * @param {CryptoKey} privateKey - recipient's private key
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<ReceiverSession>}
 */
export async function createReceiverSession(enc, privateKey, { timeoutMs = 30_000 } = {}) {
  if (!privateKey) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing recipient privateKey" });
  }

  const ctx = await withTimeout(
    suite.createRecipientContext({ recipientKey: privateKey, enc: asU8(enc) }),
    timeoutMs
  );

  // Serialize decryptions as well (protect against accidental parallel opens)
  let recvQueue = Promise.resolve();

  const open = (ct, aad) => {
    const job = async () => {
      const buf = await withTimeout(
        ctx.open(asU8(ct), aad ? asU8(aad) : undefined),
        timeoutMs
      );
      return toU8(buf); // normalize to Uint8Array
    };
    recvQueue = recvQueue.then(job, job);
    return recvQueue;
  };

  const exportSecret =
    typeof ctx.export === "function"
      ? async (info, len) =>
          toU8(await withTimeout(ctx.export(asU8(info), len), timeoutMs))
      : undefined;

  return {
    open,
    hpkeOpen: open, // back-compat alias
    exportSecret,
  };
}
