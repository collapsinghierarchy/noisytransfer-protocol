import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSender, createAuthReceiver } from '@noisytransfer/noisyauth';

test('noisyauth exports creators', () => {
  assert.equal(typeof createAuthSender, 'function');
  assert.equal(typeof createAuthReceiver, 'function');
});