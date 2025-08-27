import { NoisyError } from '@noisytransfer/errors/noisy-error';
import { PROTO_LABEL } from '@noisytransfer/constants';
import { unb64u } from '@noisytransfer/util/base64';
import { asU8, concat, lpConcat } from '@noisytransfer/util/buffer';
import * as hash from './hash.js';
import { logger } from '@noisytransfer/util/logger';


let { sha3_256, shake128, toHex } = hash;

// Lazy SHA3/SHAKE loader (works in Node & browsers)
async function ensureSHA3() {
  if (sha3_256 && shake128) return;
  try {
    const m = await import('@noble/hashes/sha3');
    sha3_256 = m.sha3_256;
    shake128 = m.shake128;
  } catch {
    logger.warn('SAS: @noble/hashes not found; falling back to SHA-256'); 
  }
}

const enc = new TextEncoder();

/** Unbiased decimal SAS via SHAKE128(fullHash) with rejection sampling */
async function deriveSASCode(fullHash, digits = 6) {
  const M = 10 ** digits;
  const out = await shake128(fullHash, 8); // two 32-bit samples
  const MAX = Math.floor(0x1_0000_0000 / M) * M;
  for (let i = 0; i < 2; i++) {
    const o = i * 4;
    const v = ((out[o] << 24) | (out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]) >>> 0;
    if (v < MAX) return String(v % M).padStart(digits, '0');
  }
  const v = ((out[0] << 24) | (out[1] << 16) | (out[2] << 8) | out[3]) >>> 0;
  return String(v % M).padStart(digits, '0');
}

/**
 * Compute SAS + full transcript hash (hex) from auth frames.
 * @returns {Promise<{ sas: string, fullHashHex: string }>}
 */
export async function computeSASFromFrames({ roomId, sessionId, commit, offer, reveal, digits = 6 }) {
  if (!offer?.offer?.msgS || !offer?.offer?.nonceS)
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'sas: missing offer fields' });
  if (!reveal?.reveal?.msgR || !reveal?.reveal?.nonceR)
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'sas: missing reveal fields' });
  if (!commit?.commit?.commitment)
    throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'sas: missing commitment' });

  const msgS = unb64u(offer.offer.msgS);
  const nS   = unb64u(offer.offer.nonceS);
  const msgR = unb64u(reveal.reveal.msgR);
  const nR   = unb64u(reveal.reveal.nonceR);

  const header = `${PROTO_LABEL}|${roomId ?? ''}|${sessionId ?? ''}|${commit.commit.commitment}`;
  const transcript = lpConcat([enc.encode(header), msgS, nS, msgR, nR]); // Uint8Array

  const fullHash = await sha3_256(transcript);
  return {
    sas: await deriveSASCode(fullHash, digits),
    fullHashHex: toHex(fullHash),
  };
}
