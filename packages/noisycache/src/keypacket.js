// Minimal, strict KeyPacket builder/parser used by the mailbox courier.
// JSON structure (bytes are base64url strings):
// {
//   type: 'nc_keypacket_v1',
//   id: string,               // objectId
//   fk_b64u: string,          // AES key bytes
//   iv_b64u: string,          // 12-byte base IV
//   chunkSize: number,
//   totalSize: number,
//   chunks: number,
//   hash: string              // hex SHA-256 of ciphertext transcript
// }

import { NoisyError } from '../errors/noisy-error.js';
import { b64u, unb64u } from '../util/base64.js';


export function buildKeyPacket({ id, fk, baseIV, chunkSize, totalSize, chunks, hash }) {
  if (typeof id !== 'string' || !id) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'id required' });
  const fkU8 = fk instanceof Uint8Array ? fk : new Uint8Array(fk);
  const ivU8 = baseIV instanceof Uint8Array ? baseIV : new Uint8Array(baseIV);
  if (ivU8.length !== 12) throw new NoisyError({ code: 'NC_BAD_PARAM', message: 'baseIV must be 12 bytes' });
  const obj = {
    type: 'nc_keypacket_v1',
    id,
    fk_b64u: b64u(fkU8),
    iv_b64u: b64u(ivU8),
    chunkSize: Number(chunkSize) | 0,
    totalSize: Number(totalSize) | 0,
    chunks: Number(chunks) | 0,
    hash: String(hash || ''),
  };
  const txt = JSON.stringify(obj);
  return new TextEncoder().encode(txt);
}

export function parseKeyPacket(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let obj;
  try { obj = JSON.parse(new TextDecoder().decode(u8)); }
  catch (e) { throw new NoisyError({ code: 'NC_KEYPACKET_BAD', message: 'invalid JSON', cause: e }); }
  if (!obj || obj.type !== 'nc_keypacket_v1') throw new NoisyError({ code: 'NC_KEYPACKET_BAD', message: 'unexpected type' });
  const { id, fk_b64u, iv_b64u, chunkSize, totalSize, chunks, hash } = obj;
  if (typeof id !== 'string' || !id) throw new NoisyError({ code: 'NC_KEYPACKET_BAD', message: 'missing id' });
  if (typeof fk_b64u !== 'string' || typeof iv_b64u !== 'string') throw new NoisyError({ code: 'NC_KEYPACKET_BAD', message: 'missing key/iv' });
  const fk = unb64u(fk_b64u);
  const baseIV = unb64u(iv_b64u);
  if (baseIV.length !== 12) throw new NoisyError({ code: 'NC_KEYPACKET_BAD', message: 'baseIV length != 12' });
  const m = {
    id,
    fk,
    baseIV,
    chunkSize: Number(chunkSize) | 0,
    totalSize: Number(totalSize) | 0,
    chunks: Number(chunks) | 0,
    hash: typeof hash === 'string' ? hash : '',
  };
  return m;
}