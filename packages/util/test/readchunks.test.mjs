import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChunks } from '../src/readChunks.js';
import { CHUNK_SIZE } from '@noisytransfer/noisytransfer-protocol/constants.js';

test('readChunks splits blobs by CHUNK_SIZE', async () => {
  const total = CHUNK_SIZE * 2 + 10;
  const buf = new Uint8Array(total).fill(1);
  const blob = new Blob([buf]);
  const chunks = [];
  for await (const chunk of readChunks(blob)) chunks.push(chunk);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].byteLength, CHUNK_SIZE);
  assert.equal(chunks[1].byteLength, CHUNK_SIZE);
  assert.equal(chunks[2].byteLength, 10);
});