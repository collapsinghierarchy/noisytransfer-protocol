import { suite } from "@noisytransfer/crypto";
import { signChunk } from "@noisytransfer/crypto";
import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { createAuthSender } from "@noisytransfer/noisyauth/sender";
import { b64u, unb64u } from "@noisytransfer/util/base64";

import { buildKeyPacket } from "./keypacket.js";
import { makeCourierFrame } from "./shared.js";

/**
 * mkSendMsgWithVK(verificationKeyU8)
 * Helper so callers can pre-build the WS mailbox message for sender auth.
 * @param {Uint8Array} verificationKeyU8
 * @returns {Uint8Array}
 */
export function mkSendMsgWithVK(verificationKeyU8) {
  if (!(verificationKeyU8 instanceof Uint8Array)) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: "mkSendMsgWithVK: expected Uint8Array" });
  }
  const payload = JSON.stringify({ type: "vk_v1", vk_b64u: b64u(verificationKeyU8) });
  return new TextEncoder().encode(payload);
}

/**
 * Sender: run authcore; receive receiver's HPKE KEM public key; open HPKE;
 * sign and seal the KeyPacket into a courier frame; then send it over WS mailbox.
 *
 * Stable API: runCourierSender({ tx, sessionId, sendMsg, signingKey, keyPacket })
 */
export async function runCourierSender({ tx, sessionId, sendMsg, keyPacket, signingKey }) {
  if (!tx) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing tx" });
  if (!sessionId) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing sessionId" });
  if (!keyPacket) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing keyPacket" });
  if (!signingKey) throw new NoisyError({ code: "NC_BAD_PARAM", message: "missing signingKey" });

  return new Promise((resolve, reject) => {
    createAuthSender(
      tx,
      {
        onSAS: () => {},
        waitConfirm: () => true, // non-blocking
        onDone: async (res = {}) => {
          try {
            const rawPeer = res.msgR ?? res.recvMsg;
            const kemPubBytes = unb64u(rawPeer);
            if (!kemPubBytes.length) {
              throw new NoisyError({ code: "NC_COURIER_NO_MSGR", message: "empty/invalid msgR" });
            }

            const kemPub = await suite.kem.deserializePublicKey(kemPubBytes);
            const ctx = await suite.createSenderContext({ recipientPublicKey: kemPub });

            // Build & sign KeyPacket (plaintext)
            const kpBytes = buildKeyPacket(keyPacket);
            const sigU8 = await signChunk(signingKey, kpBytes);

            // Seal under HPKE
            const encU8 = new Uint8Array(ctx.enc);
            const ctU8 = await ctx.seal(new Uint8Array(kpBytes));

            // Courier frame
            const frame = makeCourierFrame({ sessionId, enc: encU8, ct: ctU8, sig: sigU8 });

            // Send via WS mailbox
            tx.send(frame);
            resolve({ ok: true });
          } catch (e) {
            reject(
              e instanceof NoisyError
                ? e
                : new NoisyError({
                    code: "NC_AUTHCORE",
                    message: "authcore sender error",
                    cause: e,
                  })
            );
          }
        },
        onError: (e) =>
          reject(
            e instanceof NoisyError
              ? e
              : new NoisyError({ code: "NC_AUTHCORE", message: "authcore sender error", cause: e })
          ),
      },
      { policy: "ws_async", sessionId, sendMsg }
    );
  });
}
