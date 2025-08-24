import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyPacket, parseKeyPacket } from '@noisytransfer/noisycache';

test('key packet roundtrip', () => {
  const kp = buildKeyPacket({
    id: 'x',
    fk: new Uint8Array(16),
    baseIV: new Uint8Array(12),
    chunkSize: 1,
    totalSize: 1,
    chunks: 1,
    hash: '00'
  });
  const parsed = parseKeyPacket(kp);
  assert.equal(parsed.id, 'x');
  assert.equal(parsed.fk.length, 16);
});