import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as protocol from '@noisytransfer/noisytransfer-protocol';
import { CHUNK_SIZE } from '@noisytransfer/noisytransfer-protocol/protocol/constants.js';

test('aggregator exports namespaces and constants', () => {
  assert.ok(protocol.crypto);
  assert.ok(CHUNK_SIZE > 0);
});