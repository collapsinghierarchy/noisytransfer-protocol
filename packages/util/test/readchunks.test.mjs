import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChunks, CHUNK_SIZE } from '../src/readChunks.js';

test('readChunks splits blobs by CHUNK_SIZE', async () => {
  const total = CHUNK_SIZE * 2 + 10;
  const buf = new Uint8Array(total).fill(1);
  const blob = new Blob([buf]);
  const chunks = [];
  for await (const chunk of readChunks(blob)) chunks.push(chunk);

  // Each chunk should be <= CHUNK_SIZE
  for (const chunk of chunks) {
    assert(chunk.byteLength <= CHUNK_SIZE);
  }

  // Concatenated chunks should equal original buffer
  const combined = Buffer.concat(chunks.map(c => Buffer.from(c)));
  assert.equal(combined.length, total);
  assert.ok(combined.equals(Buffer.from(buf)));
});