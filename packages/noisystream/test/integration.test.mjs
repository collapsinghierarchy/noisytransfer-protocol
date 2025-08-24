import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendFileWithAuth, recvFileWithAuth } from '@noisytransfer/noisystream';

test('noisystream exports functions', () => {
  assert.equal(typeof sendFileWithAuth, 'function');
  assert.equal(typeof recvFileWithAuth, 'function');
});