import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigInit, sigAddData, sigFinalize } from '@noisytransfer/crypto';

const rand = (n)=>{ const u=new Uint8Array(n); crypto.getRandomValues(u); return u; };

test('sig transcript: frames/bytes affect final digest', async () => {
  const base = { sessionId:'s2', totalBytes: 2000, hpkeEnc: rand(32), aadId: 'AAD' };
  const ct = [rand(10), rand(10), rand(10)];

  const st1 = await sigInit(base);
  await sigAddData(st1, 0, ct[0]);
  await sigAddData(st1, 1, ct[1]);
  const d1 = await sigFinalize(st1, { frames: 3, bytes: 20 });

  const st2 = await sigInit(base);
  await sigAddData(st2, 0, ct[0]);
  await sigAddData(st2, 1, ct[1]);
  const d2 = await sigFinalize(st2, { frames: 4, bytes: 21 });

  const eq = (a,b)=> a.length===b.length && a.every((v,i)=>v===b[i]);
  assert.equal(eq(d1, d2), false, 'changing frames/bytes must change digest');
});
