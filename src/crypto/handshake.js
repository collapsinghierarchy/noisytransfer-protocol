import { suite } from "./suite.js";
import { withTimeout } from "../util/async.js";
import { NoisyError } from "../errors/noisy-error.js";
import { asU8 } from "../util/buffer.js";

/** Normalize to a tight Uint8Array view (no offset/length surprises). */
function toU8(input) {
  const u = asU8(input);
  return new Uint8Array(u.buffer, u.byteOffset, u.byteLength);
}

/**
 * Sender: given the receiver’s public key, perform HPKE sender handshake.
 * Returns:
 *   {
 *     seal(pt[, aad]) : Promise<Uint8Array>,
 *     hpkeSeal(pt[, aad]) : Promise<Uint8Array>,   // alias (clearer name)
 *     exportSecret?(info:Uint8Array, len:number) : Promise<Uint8Array>, // if HPKE impl supports exporter
 *     enc : ArrayBuffer
 *   }
 */
export async function createSenderSession(receiverPublicKey) {
  const pkU8 = toU8(receiverPublicKey);
  if (pkU8.byteLength === 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "crypto/handshake: receiver public key is empty" });
  }

  let kemPK;
  try {
    kemPK = await suite.kem.deserializePublicKey(pkU8);
  } catch (e) {
    throw new NoisyError({
      code: "NC_BAD_PARAM",
      message: "crypto/handshake: failed to deserialize public key",
      context: { error: e }
    });
  }

  let ctx;
  try {
    ctx = await withTimeout(
      suite.createSenderContext({ recipientPublicKey: kemPK }),
      "createSenderContext",
      10_000
    );
  } catch (e) {
    throw new NoisyError({
      code: "NC_BAD_PARAM",
      message: "crypto/handshake: failed to create sender context",
      context: { error: e }
    });
  }

  const seal = (pt, aad) => ctx.seal(toU8(pt), aad ? toU8(aad) : undefined);
  const exportSecret = ctx.export
    ? async (info, len) => {
        const out = await ctx.export(toU8(info), len);
        return out instanceof Uint8Array ? out : new Uint8Array(out);
      }
    : undefined;

  return {
    seal,
    hpkeSeal: seal,
    exportSecret,
    enc: ctx.enc,
  };
}

/**
 * Receiver: given the HPKE encapsulation and the recipient's private key, complete HPKE.
 * Returns:
 *   {
 *     open(ct[, aad]) : Promise<Uint8Array>,
 *     hpkeOpen(ct[, aad]) : Promise<Uint8Array> // alias (clearer name)
 *   }
 */
export async function createReceiverSession(encapsulation, recipientPrivateKey) {
  const encU8 = toU8(encapsulation);
  if (encU8.byteLength === 0) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "crypto/handshake: encapsulation is empty" });
  }

  let ctx;
  try {
    ctx = await withTimeout(
      suite.createRecipientContext({ recipientKey: recipientPrivateKey, enc: encU8 }),
      "createRecipientContext",
      10_000
    );
  } catch (e) {
    throw new NoisyError({
      code: "NC_BAD_PARAM",
      message: "crypto/handshake: failed to create receiver context",
      context: { error: e }
    });
  }

  const open = (ct, aad) => ctx.open(toU8(ct), aad ? toU8(aad) : undefined);

  return {
    open,
    hpkeOpen: open,
  };
}
