// src/crypto/stream.js

import { STREAM } from "@noisytransfer/constants";
import { NoisyError } from "@noisytransfer/errors/noisy-error";
import { withTimeout } from "@noisytransfer/util/async";
import { b64u } from "@noisytransfer/util/base64";
import { asU8 } from "@noisytransfer/util/buffer";

import { makeEncryptor, makeDecryptor } from "./aead.js";
import { createSenderSession, createReceiverSession } from "./handshake.js";

/**
 * Build a symmetric stream context derived from HPKE via the **exporter**.
 * he HPKE context must provide an exporter.
 *
 * Returns:
 *   Sender => { seal(pt): Promise<Uint8Array>, open: throws, enc: ArrayBuffer, id: string }
 *   Receiver => { open(ct): Promise<Uint8Array>, seal: throws, id: string }
 *
 * The AAD 'id' defaults to a stable string derived from 'enc' so both sides agree.
 */
export async function mkAeadStreamFromHpke(role, peerMaterial, ownPriv, opts = {}) {
  // 1) Establish HPKE session
  let sess;
  try {
    if (role === "sender") {
      sess = await withTimeout(
        createSenderSession(asU8(peerMaterial)),
        "createSenderSession",
        10_000
      );
    } else if (role === "receiver") {
      sess = await withTimeout(
        createReceiverSession(asU8(peerMaterial), ownPriv),
        "createReceiverSession",
        10_000
      );
    } else {
      throw new NoisyError({
        code: "NC_BAD_PARAM",
        message: `mkAeadStreamFromHpke: unknown role "${role}"`,
      });
    }
  } catch (e) {
    throw new NoisyError({ code: "NC_BAD_PARAM", message: `Session creation error: ${e.message} -- role "${role}"`});
  }

  // 2) Require HPKE exporter
  if (typeof sess.exportSecret !== "function") {
    throw new NoisyError({
      code: "NC_UNSUPPORTED_ALG",
      message: `HPKE exporter is required for stream key derivation (no fallback) -- role "${role}".`,
    });
  }

  // 3) Derive symmetric key & baseIV via exporter
  // This stream is S→R only: sender seals, receiver opens.
  // Both roles must derive the same material → always use LABEL_S2R.
  const LABEL = new TextEncoder().encode(STREAM.LABEL_S2R);
  const KM_LEN = 32 + 12; // AES-256 key + 96-bit IV
  const km = await sess.exportSecret(LABEL, KM_LEN);
  const kmU8 = km instanceof Uint8Array ? km : new Uint8Array(km);
  const key = kmU8.slice(0, 32);
  const baseIV = kmU8.slice(32, 44);

  // 4) Choose AAD stream id (stable across both sides)
  //    We use 'enc' only for ID (AAD), not for keying.
  const encBytes = asU8(role === "sender" ? sess.enc : peerMaterial);
  const id = opts.id || b64u(encBytes.slice(0, 8)); // short stable string

  // 5) Build AEAD context (encryptor/decryptor)
  if (role === "sender") {
    const enc = await makeEncryptor(key, baseIV);
    let seq = 0;
    async function seal(pt) {
      return enc.encryptChunk(id, seq++, asU8(pt));
    }
    return {
      seal,
      open: async () => {
        throw new NoisyError({ code: "NC_PROTOCOL", message: "sender cannot open" });
      },
      enc: sess.enc,
      id,
    };
  } else {
    const dec = await makeDecryptor(key, baseIV);
    let seq = 0;
    async function open(ct) {
      return dec.decryptChunk(id, seq++, asU8(ct));
    }
    return {
      open,
      seal: async () => {
        throw new NoisyError({ code: "NC_PROTOCOL", message: "receiver cannot seal" });
      },
      id,
    };
  }
}

// Back-compat export name
export const mkStream = mkAeadStreamFromHpke;
