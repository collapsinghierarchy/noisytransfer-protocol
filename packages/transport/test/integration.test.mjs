import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransport } from '@noisytransfer/transport';

test('isTransport identifies shape', () => {
  const dummy = {
    send() {},
    close() {},
    onMessage() { return () => {}; },
    onClose() { return () => {}; }
  };
  assert.ok(isTransport(dummy));
});