import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, sigInit, sigAddData, sigFinalize } from '@noisytransfer/crypto';

const te = new TextEncoder();
const rand = (n)=>{ const u=new Uint8Array(n); crypto.getRandomValues(u); return u; };

test('sig transcript: determinism for same inputs', async () => {
  const sessionId = 'sid-123';
  const totalBytes = 123456;
  const hpkeEnc = rand(32);
  const aadId = 'AAD-ID-XYZ';

  const ct0 = rand(111);
  const ct1 = rand(222);

  const stA = await sigInit({ sessionId, totalBytes, hpkeEnc, aadId });
  await sigAddData(stA, 0, ct0);
  await sigAddData(stA, 1, ct1);
  const digA = await sigFinalize(stA, { frames: 3, bytes: totalBytes });

  const stB = await sigInit({ sessionId, totalBytes, hpkeEnc, aadId });
  await sigAddData(stB, 0, ct0);
  await sigAddData(stB, 1, ct1);
  const digB = await sigFinalize(stB, { frames: 3, bytes: totalBytes });

  assert.equal(digA.length, 32);
  assert.equal(digB.length, 32);
  assert.deepEqual(digA, digB, 'same inputs must yield same transcript digest');
});

test('sig transcript: order and content affect digest', async () => {
  const sessionId = 'sid-abc';
  const totalBytes = 999;
  const hpkeEnc = rand(32);
  const aadId = 'AAD-ID-XYZ';

  const ct0 = rand(64);
  const ct1 = rand(64);

  const st1 = await sigInit({ sessionId, totalBytes, hpkeEnc, aadId });
  await sigAddData(st1, 0, ct0);
  await sigAddData(st1, 1, ct1);
  const d1 = await sigFinalize(st1, { frames: 3, bytes: totalBytes });

  // Different order
  const st2 = await sigInit({ sessionId, totalBytes, hpkeEnc, aadId });
  await sigAddData(st2, 1, ct1);
  await sigAddData(st2, 0, ct0);
  const d2 = await sigFinalize(st2, { frames: 3, bytes: totalBytes });

  // Tampered content
  const ct1x = new Uint8Array(ct1);
  ct1x[0] ^= 0x01;
  const st3 = await sigInit({ sessionId, totalBytes, hpkeEnc, aadId });
  await sigAddData(st3, 0, ct0);
  await sigAddData(st3, 1, ct1x);
  const d3 = await sigFinalize(st3, { frames: 3, bytes: totalBytes });

  const eq = (a,b)=> a.length===b.length && a.every((v,i)=>v===b[i]);

  assert.equal(eq(d1, d2), false, 'reordering seq must change digest');
  assert.equal(eq(d1, d3), false, 'tampering ciphertext must change digest');
});

test('sig transcript: metadata binds context (aadId / hpkeEnc / totalBytes)', async () => {
  const base = { sessionId:'s', totalBytes:1000, hpkeEnc: rand(32), aadId: 'A1' };

  const st = await sigInit(base);
  await sigAddData(st, 0, rand(10));
  const dBase = await sigFinalize(st, { frames: 2, bytes: 1000 });

  for (const variant of [
    { ...base, totalBytes: 1001 },
    { ...base, aadId: 'A2' },
    { ...base, hpkeEnc: Uint8Array.from(base.hpkeEnc, b=>b) .map((x,i)=> i===0? x^1 : x) },
  ]) {
    const stV = await sigInit(variant);
    await sigAddData(stV, 0, rand(10));
    const dV = await sigFinalize(stV, { frames: 2, bytes: variant.totalBytes });
    const eq = dBase.length===dV.length && dBase.every((v,i)=>v===dV[i]);
    assert.equal(eq, false, 'changing context must change digest');
  }
});
