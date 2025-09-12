import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { b64u } from "@noisytransfer/util/base64";
import { asU8, toU8 } from "@noisytransfer/util/buffer";
import { createSenderSession, createReceiverSession } from "./handshake.js";

/**
 * Streaming facade over HPKE contexts. Assumes ordered delivery.
 * Caller-supplied { id } is honored verbatim on both sides.
 * @param {"sender"|"receiver"} role
 * @param {Uint8Array|ArrayBuffer} arg1 - sender: recipient public key bytes; receiver: enc from sender
 * @param {CryptoKey|undefined} arg2 - sender: undefined; receiver: recipient private key
 * @param {{timeoutMs?: number, id?: string}} [opts]
 */
export async function mkAeadStreamFromHpke(role, arg1, arg2, opts = {}) {
  const { timeoutMs = 30_000, id: forcedId } = opts || {};

  if (role === "sender") {
    const sender = await createSenderSession(arg1, { timeoutMs });
    const enc = toU8(sender.enc);
    const id = forcedId || b64u(enc); // ← USE caller-provided id when present

    return {
      /** @param {Uint8Array|ArrayBuffer} pt @param {Uint8Array|ArrayBuffer} [aad] */
      seal: (pt, aad) => sender.seal(asU8(pt), aad ? asU8(aad) : undefined),
      open: async () => { throw new NoisyError({ code: "NC_PROTOCOL", message: "sender is not intended to decrypt" }); },
      enc,
      id,
    };
  }

  if (role === "receiver") {
    const enc = toU8(arg1);
    const receiver = await createReceiverSession(enc, arg2, { timeoutMs });
    const id = forcedId || b64u(enc); // ← MUST match the sender's id

    return {
      /** @param {Uint8Array|ArrayBuffer} ct @param {Uint8Array|ArrayBuffer} [aad] */
      open: (ct, aad) => receiver.open(asU8(ct), aad ? asU8(aad) : undefined),
      seal: async () => { throw new NoisyError({ code: "NC_PROTOCOL", message: "receiver is not intended to encrypt" }); },
      id,
    };
  }

  throw new NoisyError({ code: "NC_BAD_PARAM", message: `unknown role: ${role}` });
}
