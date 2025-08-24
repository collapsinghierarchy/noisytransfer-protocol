// src/noisycache/courier.js
import { NoisyError } from '../errors/noisy-error.js';
import { createAuthSender } from '../noisyauth/sender.js';
import { createAuthReceiver } from '../noisyauth/receiver.js';
import { suite } from '../crypto/suite.js';
import { buildKeyPacket, parseKeyPacket } from './keypacket.js';
import { signChunk, importVerifyKey, verifyChunk } from '../crypto/signature.js';
import { b64u, unb64u } from '../util/base64.js';


const FRAME_TYPE = 'nc_courier_v1';
const te = new TextEncoder();
const td = new TextDecoder();

export function mkSendMsgWithVK(verificationKeyU8) {
  if (!(verificationKeyU8 instanceof Uint8Array)) {
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'verificationKey must be Uint8Array' });
  }
  const body = { vk_b64u: b64u(verificationKeyU8) };
  return te.encode(JSON.stringify(body)).buffer; // ArrayBuffer, like your existing tests
}

/**
 * Sender: run authcore; HPKE-seal & sign a KeyPacket; send one courier frame.
 *
 * @param {object} p
 * @param {*} p.tx
 * @param {string} p.sessionId
 * @param {ArrayBuffer|Uint8Array|string} p.sendMsg  // must contain vk_b64u JSON (use mkSendMsgWithVK)
 * @param {{id:string,fk:Uint8Array,baseIV:Uint8Array,chunkSize:number,totalSize:number,chunks:number,hash:string}} p.keyPacket
 * @param {CryptoKey} p.signingKey  // RSA-PSS private key
 */
export async function runCourierSender({ tx, sessionId, sendMsg, keyPacket, signingKey }) {
  if (!tx) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing tx' });
  if (!sessionId) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing sessionId' });
  if (!keyPacket) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing keyPacket' });
  if (!signingKey) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing signingKey' });

  return new Promise((resolve, reject) => {
    createAuthSender(tx, {
      onSAS:  () => {},               // non-blocking; caller can log elsewhere if desired
      waitConfirm: () => true,       // do NOT block on SAS confirm
      onDone: async (res = {}) => {
        try {
          const rawPeer = res.msgR ?? res.recvMsg;   // sender gets receiver message
          const kemPubBytes = unb64u(rawPeer);
          if (!kemPubBytes.length) throw new NoisyError({ code: 'NC_COURIER_NO_MSGR', message: 'empty/invalid msgR' });

          const kemPub = await suite.kem.deserializePublicKey(kemPubBytes);
          const ctx = await suite.createSenderContext({ recipientPublicKey: kemPub });

          // Build & sign KeyPacket (plaintext)
          const kpBytes = buildKeyPacket(keyPacket);       // Uint8Array
          const sigU8   = await signChunk(signingKey, kpBytes);

          // Seal under HPKE
          const encU8 = new Uint8Array(ctx.enc);
          const ctU8  = new Uint8Array(await ctx.seal(kpBytes));

          // Courier frame
          const frame = { type: FRAME_TYPE, sessionId, enc: b64u(encU8), ct: b64u(ctU8), sig: b64u(sigU8), sigAlg: 'RSA-PSS-SHA256' };
          // Send via mailbox: signature is send(to, payload)
          try { tx.send(frame); } // simple: A→B
          catch (e) { throw new NoisyError({ code: 'NC_TX_SEND', message: 'courier send failed', cause: e }); }

          resolve({ ok: true });
        } catch (e) {
          reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_COURIER_SENDER', message: 'courier sender failed', cause: e }));
        }
      },
      onError: (e) => reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_AUTHCORE', message: 'authcore sender error', cause: e })),
    }, { policy: 'ws_async', sessionId, sendMsg });
  });
}

/**
 * Receiver: run authcore; import sender VK from msgS; verify & open courier frame; return parsed KeyPacket.
 *
 * @param {object} p
 * @param {*} p.tx
 * @param {string} p.sessionId
 * @param {ArrayBuffer|Uint8Array|string} p.recvMsg      // receiver message (e.g., KEM pub bytes)
 * @param {*} p.recipientPrivateKey                      // HPKE private key
 * @returns {Promise<{ keyPacket: {id,fk,baseIV,chunkSize,totalSize,chunks,hash} }>}
 */
export async function runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey }) {
  if (!tx) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing tx' });
  if (!sessionId) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing sessionId' });
  if (!recipientPrivateKey) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing recipientPrivateKey' });

  let verifyKey = null;
  let pending = null;

  async function processFrame(frame) {
    const enc = unb64u(frame.enc);
    const ct  = unb64u(frame.ct);
    const sig = unb64u(frame.sig);

    const ctx = await suite.createRecipientContext({ recipientKey: recipientPrivateKey, enc });
    const pt  = new Uint8Array(await ctx.open(ct));

    if (!verifyKey) throw new NoisyError({ code: 'NC_NO_VK', message: 'verification key not ready' });
    const ok = await verifyChunk(verifyKey, sig, pt);
    if (!ok) throw new NoisyError({ code: 'NC_KEYPACKET_SIG_INVALID', message: 'RSA-PSS verify failed' });

    return parseKeyPacket(pt);
  }

    const FRAME_TYPE = 'nc_courier_v1';

    const pktP = new Promise((resolve, reject) => {
    const un = tx.onMessage(async (m) => {
        try {
        if (!m || m.type !== FRAME_TYPE || m.sessionId !== sessionId) return;
        const parsed = await processFrame(m);
        try { un?.(); } catch {}
        resolve({ keyPacket: parsed });
        } catch (e) {
        try { un?.(); } catch {}
        reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_COURIER_RECEIVER', message: 'courier receiver failed', cause: e }));
        }
    });

    // Run authcore; learn sender's VK from msgS
    createAuthReceiver(tx, {
      onSAS: () => {},             // non-blocking
      waitConfirm: () => true,
      onDone: async (res = {}) => {
        try {
          const rawS = unb64u(res.msgS ?? res.sendMsg ?? res.senderMsg ?? res.msg);
          const txt  = td.decode(rawS);
          const obj  = JSON.parse(txt);
          if (typeof obj?.vk_b64u !== 'string') throw new NoisyError({ code: 'NC_NO_VK', message: 'sender did not include vk_b64u in sendMsg' });
          verifyKey = await importVerifyKey(unb64u(obj.vk_b64u));
          if (pending) {
            const parsed = await processFrame(pending);
            try { un?.(); } catch {}
            resolve({ keyPacket: parsed });
          }
        } catch (e) {
          try { un?.(); } catch {}
          reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_AUTHCORE', message: 'authcore receiver error', cause: e }));
        }
      },
      onError: (e) => {
        try { un?.(); } catch {}
        reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_AUTHCORE', message: 'authcore receiver error', cause: e }));
      },
    }, { policy: 'ws_async', sessionId, recvMsg });
  });

  return pktP;
}
