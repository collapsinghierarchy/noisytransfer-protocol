import { NoisyError } from '@noisytransfer/errors/noisy-error.js';
import { parseKeyPacket } from './keypacket.js';
import { createAuthReceiver } from '@noisytransfer/noisyauth/receiver.js';
import { suite } from '@noisytransfer/crypto';
import { importVerifyKey, verifyChunk } from '@noisytransfer/crypto';
import { unb64u } from '@noisytransfer/util/base64.js';
import { FRAME_TYPE, isCourierFrame } from './shared.js';

/**
 * Receiver: run authcore; import sender VK from msgS; verify & open courier frame; return parsed KeyPacket.
 *
 * Stable API: runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey })
 */
export async function runCourierReceiver({ tx, sessionId, recvMsg, recipientPrivateKey }) {
  if (!tx) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing tx' });
  if (!sessionId) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing sessionId' });
  if (!recipientPrivateKey) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'missing recipientPrivateKey' });

  let verifyKey = null;
  let pending = null;
  const backlog = [];

  async function handleCourierFrame(frame) {
    const enc = unb64u(frame.enc);
    const ct  = unb64u(frame.ct);
    const sig = unb64u(frame.sig);

    const ok = await verifyChunk(verifyKey, ct, sig);
    if (!ok) throw new NoisyError({ code: 'NC_SIGNATURE_INVALID', message: 'invalid courier signature' });

    const ctx = await suite.createRecipientContext({ recipientKey: recipientPrivateKey, enc: enc });
    const pt  = await ctx.open(ct);
    const keyPacket = parseKeyPacket(pt);
    pending?.resolve({ keyPacket });
  }

  const pktP = new Promise((resolve, reject) => {
    const un = tx.onMessage(async (m) => {
      try {
        if (!isCourierFrame(m) || m.sessionId !== sessionId) return;
        if (!verifyKey) { backlog.push(m); return; }
        await handleCourierFrame(m);
        try { un?.(); } catch {}
      } catch (e) {
        try { un?.(); } catch {}
        reject(e instanceof NoisyError ? e : new NoisyError({ code: 'NC_AUTHCORE', message: 'authcore receiver error', cause: e }));
      }
    });

    pending = { resolve, reject };

    createAuthReceiver(tx, {
      onSAS:  async () => {},
      waitConfirm: () => true,
      onDone: async (res) => {
        try {
          const rawPeer = res.msgS ?? res.sendMsg;
          const obj = typeof rawPeer === 'string' ? JSON.parse(rawPeer) : JSON.parse(new TextDecoder().decode(rawPeer));
          const vk_b64u = obj?.vk_b64u;
          if (!vk_b64u) throw new NoisyError({ code: 'NC_COURIER_NO_MSGS', message: 'missing vk_b64u in msgS' });
          const vk = await importVerifyKey(unb64u(vk_b64u));
          verifyKey = vk;
          // drain any early frames
          for (const f of backlog.splice(0)) await handleCourierFrame(f);
          try { un?.(); } catch {}
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
